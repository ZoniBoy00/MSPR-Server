"""End-to-end check of the running MSPR stack, following the game's own path:

  1. DNS   motorstorm2ps3.online.scee.com via the stack's DNS server
  2. MUIS  PS3 SCE-RT handshake (like the game) + universe info incl. SVO URL
  3. SVO   index -> ticket/login (captured NP ticket) -> getEula -> leaderboard

Usage: python -X utf8 e2e_check.py [dns_ip]
"""

from __future__ import annotations

import hashlib
import http.client
import json
import random
import socket
import struct
import sys
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import medius_testclient as mt  # noqa: E402
from medius_ids import LOBBY_CLASS, LOBBY_EXT_CLASS, GET_UNIVERSE_INFORMATION  # noqa: E402

HOSTNAME = "motorstorm2ps3.online.scee.com"
INFO_SVO_URL = 1 << 9


def dns_a(server: str, name: str) -> str:
    tid = random.randrange(65536)
    q = struct.pack(">HHHHHH", tid, 0x0100, 1, 0, 0, 0)
    q += b"".join(bytes([len(p)]) + p.encode() for p in name.split(".")) + b"\0"
    q += struct.pack(">HH", 1, 1)
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(3)
    s.sendto(q, (server, 53))
    r, _ = s.recvfrom(512)
    an = struct.unpack(">H", r[6:8])[0]
    assert an >= 1, "no A record"
    return socket.inet_ntoa(r[-4:])


def muis_svo_url(ip: str) -> str:
    c = mt.handshake(ip, 10071)
    # Ask for the SVO URL the same way Horizon's MUIS serves it for PS3 titles.
    for cls, typ in ((LOBBY_CLASS, GET_UNIVERSE_INFORMATION),):
        req = mt.medius_msg(cls, typ, mt.msgid("e2e") + b"\0" * 3 +
                            struct.pack("<iii", INFO_SVO_URL | 0x1C | 0x40, 0, 1))
        c.send(0x0b, req, cipher=c.rcq)
    c.s.settimeout(2)
    url = None
    try:
        while True:
            mid, body = c.recv()
            if mid == 0x0a and body[:2] == bytes([LOBBY_EXT_CLASS, 0x1E]):
                # game reader (EBOOT 0x648f18): MessageID[21] varint-len, bytes incl. NUL (the original service: 151 B)
                n = body[2 + 21]
                data = body[2 + 22:2 + 22 + n]
                text = data.split(b"\0", 1)[0]
                if len(body) != 151 or n != len(text) + 1 or data[-1:] != b"\0" or b"?languageID=" not in text:
                    print("    !! SvoURL message not in the game's format (%d B, len byte %#x)" % (len(body), n))
                    return None
                url = data.split(b"\0", 1)[0].decode()
    except (socket.timeout, ConnectionError):
        pass
    return url


def drain(c, seconds=1.5):
    """Collect replies for `seconds` (server echoes must not extend the wait)."""
    import time
    deadline = time.time() + seconds
    out = []
    try:
        while time.time() < deadline:
            c.s.settimeout(max(0.05, deadline - time.time()))
            out.append(c.recv())
    except (socket.timeout, ConnectionError):
        pass
    return out


def mas_login(ip: str, port: int, ticket: bytes):
    """MSPR's MAS sequence (sizes from the original service captures):
    ExtendedSessionBegin(42)->50, SetLocalizationParams1(58)->30, TicketLogin(~299)->227."""
    from medius_ids import (EXTENDED_SESSION_BEGIN_REQUEST, SET_LOCALIZATION_PARAMS_REQUEST1,
                            TICKET_LOGIN)
    c = mt.handshake(ip, port)
    c.send(0x0b, mt.medius_msg(LOBBY_EXT_CLASS, EXTENDED_SESSION_BEGIN_REQUEST,
                               mt.msgid("sb") + b"\0" * 3 + struct.pack("<iiii", 1, 3, 3, 0)), cipher=c.rcq)
    r = drain(c)
    sizes = [len(b) for _, b in r]
    session_key = b""
    for mid, body in r:
        if mid == 0x0a and len(body) == 50:
            session_key = body[2 + 21 + 3 + 4:2 + 21 + 3 + 4 + 17].split(b"\0", 1)[0]
    print("    SessionBegin -> %s session_key=%r (the original service: [50])" % (sizes, session_key))

    c.send(0x0b, mt.medius_msg(LOBBY_EXT_CLASS, SET_LOCALIZATION_PARAMS_REQUEST1,
                               mt.msgid("loc") + session_key.ljust(17, b"\0") + b"\0\0" +
                               struct.pack("<iiii", 1, 1, 2, -1)), cipher=c.rcq)   # LocationID -1 like the game
    print("    SetLocalization -> %s (the original service: [30])" % [len(b) for _, b in drain(c)])

    c.send(0x0b, mt.medius_msg(LOBBY_EXT_CLASS, TICKET_LOGIN,
                               mt.msgid("tl") + session_key.ljust(17, b"\0") + b"\0" * 4 + ticket),
           cipher=c.rcq)
    r = drain(c, 3)
    print("    TicketLogin -> %s (the original service: [227])" % [len(b) for _, b in r])
    for mid, body in r:
        if mid == 0x0a and len(body) > 100:
            # NetConnectionInfo: type, 2x(addr[16], port), world, server key[64], session[17], access[17]
            ips = [s.decode() for s in body.split(b"\0") if s.count(b".") == 3 and len(s) < 16]
            a = body.find(ips[0].encode())
            port = struct.unpack("<i", body[a + 16:a + 20])[0]
            sk_at = body.rfind(session_key + b"\0")
            access = body[sk_at + 17:sk_at + 34].split(b"\0", 1)[0]
            print("    login OK -> MLS %s:%d session=%r access=%r" % (ips[0], port, session_key, access))
            return ips[0], port, session_key, access
    return None


def mls_connect(ip, port, session_key, access):
    print("[2c] MLS %s:%d handshake with session key + access token" % (ip, port))
    c = mt.handshake(ip, port, session_key=session_key, access_token=access)
    print("    MLS handshake OK")
    ok = ranked_matchmaking(c, session_key)                   # closes the lobby connection (referral to MMS)
    c = mt.handshake(ip, port, session_key=session_key, access_token=access)
    print("    MLS reconnect after MMS OK")
    ok &= stats_roundtrip(c, session_key)
    c.s.close()
    return ok


def stats_roundtrip(c, session_key: bytes) -> bool:
    """MediusAccountUpdateStats (Lobby 0x11) -> Horizon -> server SQLite (shared account id)."""
    import base64
    import urllib.request
    print("[2e] account stats -> database")
    api = "http://127.0.0.1:8080/horizon/accounts"
    sk = session_key.ljust(17, b"\0")[:17]

    def accounts():
        return json.loads(urllib.request.urlopen(api, timeout=3).read())

    def post(blob):
        c.send(0x0b, mt.medius_msg(LOBBY_CLASS, 0x11, mt.msgid("st") + sk + blob), cipher=c.rcq)
        drain(c, 1.5)

    try:
        before = {a["AccountName"]: a.get("MediusStats") for a in accounts()}
    except OSError as e:
        print("    !! server API not reachable: %s" % e)
        return False
    blob = bytes((i * 7 + 3) & 0xFF for i in range(256))
    post(blob)
    hit = [a for a in accounts() if a.get("MediusStats") and base64.b64decode(a["MediusStats"]) == blob]
    for a in hit:
        print("    stored for %s (account id %s, same id as SVO login)" % (a["AccountName"], a["AccountId"]))
        # The captured ticket is a real player's account: put their real progression back.
        original = before.get(a["AccountName"])
        post(base64.b64decode(original) if original else bytes(256))
        print("    original stats restored")
    if not hit:
        print("    !! stats not found in database")
    return bool(hit)


def ranked_matchmaking(c, session_key: bytes) -> bool:
    """MSPR ranked flow (EBOOT v1.03): GetSupersetList -> MatchPartyRequest2 -> JoinAssignedGame."""
    print("[2d] ranked matchmaking")
    sk = session_key.ljust(17, b"\0")[:17]
    c.send(0x0b, mt.medius_msg(LOBBY_EXT_CLASS, 0x5D, mt.msgid("ss") + sk), cipher=c.rcq)
    supersets = []
    for mid, body in drain(c):
        if mid == 0x0a and body[:2] == bytes([LOBBY_EXT_CLASS, 0x5E]):
            p = body[2:]
            status, eol, _status2, sid = struct.unpack_from("<iBii", p, 21)
            supersets.append(sid)
    print("    supersets: %s (the original service sent 2 x 64 B; game asks for superset 2)" % supersets)

    accountless = struct.pack("<i", 1)                     # party of one (account id filled by server)
    appdata = bytes([1, 0, 0, 0]) + struct.pack(">i", 3) + b"\0" * 4   # ranked=1, avg rank 3
    body = (mt.msgid("mp") + sk + struct.pack("<iiiiii", 2, 1, 6, 12, 2, len(appdata))
            + accountless + appdata)
    party_request = mt.medius_msg(LOBBY_EXT_CLASS, 0x78, body)
    c.send(0x0b, party_request, cipher=c.rcq)
    mms = None
    for mid, body in drain(c, 6):
        if mid == 0x0a and body[:2] == bytes([LOBBY_EXT_CLASS, 0x60]):
            status, plugin = struct.unpack_from("<ii", body, 2 + 21)
            if status == 8 and len(body) == 191:              # The original service's referral is 191 B too
                info = body[2 + 21 + 12:]                     # NetConnectionInfo: type, 2 x (type, addr[16], port)
                ip = info[8:24].split(b"\x00", 1)[0].decode()
                port = struct.unpack_from("<i", info, 24)[0]
                skey = info[4 + 48 + 4 + 64:][:17].split(b"\x00", 1)[0]
                akey = info[4 + 48 + 4 + 64 + 17:][:17].split(b"\x00", 1)[0]
                mms = (ip, port, skey, akey)
                print("    MLS MatchPartyResponse: Referral -> MMS %s:%d (%d B)" % (ip, port, len(body)))
            else:
                print("    !! MLS MatchPartyResponse status=%d (%d B), expected Referral" % (status, len(body)))
    if not mms:
        return False
    c.s.close()                                               # like the game: leave the lobby, then go to MMS
    m = mt.handshake(mms[0], mms[1], session_key=mms[2], access_token=mms[3])
    m.send(0x0b, party_request, cipher=m.rcq)                 # the game resends the request on MMS
    for mid, body in drain(m, 6):
        if mid == 0x0a and body[:2] == bytes([LOBBY_EXT_CLASS, 0x60]):
            status, plugin = struct.unpack_from("<ii", body, 2 + 21)
            if status == 6:
                world = struct.unpack_from("<i", body, 2 + 21 + 8)[0]
                print("    MMS MatchPartyResponse: JoinAssignedGame world=%d (%d B)" % (world, len(body)))
                # the game then asks MMS for its lobby (JoinLeastPopulatedChannel, LobbyExt 0x71)
                m.send(0x0b, mt.medius_msg(LOBBY_EXT_CLASS, 0x71, mt.msgid("lp") + session_key.ljust(17, bytes(1))[:17]
                                           + bytes(2) + bytes(4)), cipher=m.rcq)
                back = [b for mid2, b in drain(m, 3) if mid2 == 0x0a and b[:2] == bytes([LOBBY_EXT_CLASS, 0x72])]
                ok = bool(back) and struct.unpack_from("<i", back[0], 2 + 21)[0] == 0
                print("    MMS JoinLeastPopulatedChannel -> %s" % ("lobby connect info (%d B)" % len(back[0]) if ok else "!! no answer"))
                m.s.close()
                return ok and 2 in supersets
            print("    MMS MatchPartyResponse status=%d" % status)
    print("    !! no JoinAssignedGame from MMS")
    return False


def svo(host, port, method, path, mac=None, body=None, cookie=None):
    mac = mac or "%032x" % random.getrandbits(128)
    h = {"Host": "svo", "X-SVOMac": mac, "SVO-Platform": "PS3", "Connection": "close"}
    if cookie:
        h["Cookie"] = cookie
    if body is not None:
        h["Content-Type"] = "application/octet-stream"
    c = http.client.HTTPConnection(host, port, timeout=5)
    c.request(method, path, body=body, headers=h)
    r = c.getresponse()
    data = r.read().decode()
    good = r.getheader("X-SVOMac") == hashlib.md5((mac + "sp9ck0348sld" + "0" * 20).encode()).hexdigest()
    svo.set_cookie = r.getheader("Set-Cookie")
    return r.status, good, data


def main():
    dns_ip = sys.argv[1] if len(sys.argv) > 1 else mt.socket.gethostbyname(socket.gethostname())
    ok = True

    ip = dns_a(dns_ip, HOSTNAME)
    print("[1] DNS  %s -> %s" % (HOSTNAME, ip))

    print("[2] MUIS handshake + universe info")
    url = muis_svo_url(ip)
    print("    SVO URL from MUIS: %r" % url)
    if not url:
        print("    !! MUIS did not return an SVO URL")
        return 1
    u = urllib.parse.urlparse(url)
    svo_ip = u.hostname
    if not all(part.isdigit() for part in svo_ip.split(".")):
        svo_ip = dns_a(dns_ip, u.hostname)        # the game resolves the SVO host through our DNS too
        print("    DNS  %s -> %s" % (u.hostname, svo_ip))

    ticket = json.loads((HERE.parents[1] / "server" / "test" / "fixtures" / "svo" / "POST_motorstormpr_https_ticket_login.json")
                        .read_text(encoding="utf-8"))[0]["request_body"].encode("latin-1")
    print("[2b] MAS :10075 session + NP ticket login")
    login = mas_login(ip, 10075, ticket)
    if login:
        ok &= mls_connect(*login)
    else:
        print("    !! ticket login failed (captured tickets expire after 15 min:"
              " start the stack with -TestMode to replay them)")
        ok = False

    print("[3] SVO %s:%d" % (svo_ip, u.port))
    st, good, body = svo(svo_ip, u.port, "GET", u.path + "?" + (u.query or "languageID=1"))
    print("    index        %d mac=%s urls=%d" % (st, good, body.count("<DATA ")))
    ok &= st == 200 and good and "ticketLogin" in body

    rec = json.loads((HERE.parents[1] / "server" / "test" / "fixtures" / "svo" / "POST_motorstormpr_https_ticket_login.json")
                     .read_text(encoding="utf-8"))[0]
    st, good, body = svo(svo_ip, u.port, "POST",
                         "/motorstormpr/https:ticket/login?sig=x&userContext=0&sigclass=0&siglength=16&timeZone=1&languageID=1",
                         body=rec["request_body"].encode("latin-1"))
    aid = body.split("<accountID>")[1].split("<")[0] if "<accountID>" in body else "?"
    print("    login        %d mac=%s accountID=%s" % (st, good, aid))
    ok &= st == 200 and good and aid != "?"

    # the game sends back only what the login set (AuthKeyTime=...), so use exactly that
    cookie = (svo.set_cookie or "").split(";")[0]
    print("    session cookie %r" % cookie)
    for path in ("/motorstormpr/getRegion?country=fi",
                 "/motorstormpr/getEula?country=fi&languageCode=1",
                 "/motorstormpr/acceptEula?country=fi&languageCode=1",
                 "/motorstormpr/getAnnouncement?country=fi&languageCode=1",
                 "/motorstormpr/leaderboard/timeattack?location.region=0&row=0&pageSize=10&location.track=1&location.vehicle=0"):
        st, good, body = svo(svo_ip, u.port, "GET", path, cookie=cookie)
        print("    %-12s %d mac=%s" % (path.split("/")[-1].split("?")[0], st, good))
        ok &= st == 200 and good

    # a finished race must reach the time attack board (track 999 is not a real track, so the game never shows it)
    svo(svo_ip, u.port, "POST", "/motorstormpr/finishGame?location.gameMode=9&location.track=999&location.vehicle=1"
        "&endState=1&bestTime=99999&endNormal=1&position=0", body=b"", cookie=cookie)
    st, good, body = svo(svo_ip, u.port, "GET", "/motorstormpr/leaderboard/timeattack?location.region=0&row=0&pageSize=10"
                         "&location.track=999&location.vehicle=0", cookie=cookie)
    listed = 'accountId="%s"' % aid in body
    print("    finishGame -> leaderboard %s" % ("lists the race" if listed else "!! race missing"))
    ok &= listed
    try:                                            # remove the test race again (loopback-only API)
        c = http.client.HTTPConnection("127.0.0.1", 8080, timeout=3)
        c.request("DELETE", "/horizon/test-races")
        c.getresponse().read()
    except OSError:
        pass

    print("\nRESULT:", "OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
