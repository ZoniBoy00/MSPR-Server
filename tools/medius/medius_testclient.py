"""MSPR-like Medius test client (PS3 SCE-RT, Medius 1.13, app 21624).

Performs the exact handshake sequence the real game performs against
The original service (taken from re/medius_streams captures):

  C 0x24 CLIENT_HELLO (real 782-byte payload from the game)
  S 0x25 SERVER_HELLO (753-byte cert, RSA modulus at 0x194)
  C 0x12 CLIENT_CRYPTKEY_PUBLIC  (our RSA modulus, RSA-encrypted)
  S 0x13 SERVER_CRYPTKEY_PEER    (64-byte RCQ session key, encrypted to us)
  C 0x00 CLIENT_CONNECT_TCP      (world, app id, key[, session key, token])
  S 0x07 SERVER_CONNECT_ACCEPT_TCP   (the original service) | 0x22 CONNECT_REQUIRE
  C 0x21 CLIENT_CONNECT_READY_TCP
  S 0x1a SERVER_CONNECT_COMPLETE
  then Medius app messages (0x0b -> 0x0a)

Usage:
  python -X utf8 medius_testclient.py muis [host] [port]
"""

from __future__ import annotations

import json
import os
import random
import socket
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scert_crypto import RCQ, RSA, SERVER_RSA, RC_CLIENT_SESSION, hash_is_empty  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
APP_ID = 21624

RT_NAMES = {
    0x00: "CLIENT_CONNECT_TCP", 0x06: "SERVER_CONNECT_REJECT", 0x07: "SERVER_CONNECT_ACCEPT_TCP",
    0x0a: "SERVER_APP", 0x0b: "CLIENT_APP_TOSERVER", 0x11: "SERVER_FORCED_DISCONNECT",
    0x12: "CLIENT_CRYPTKEY_PUBLIC", 0x13: "SERVER_CRYPTKEY_PEER", 0x14: "SERVER_CRYPTKEY_GAME",
    0x1a: "SERVER_CONNECT_COMPLETE", 0x1c: "SERVER_SYSTEM_MESSAGE", 0x1d: "SERVER_CHEAT_QUERY",
    0x20: "CLIENT_DISCONNECT_WITH_REASON", 0x21: "CLIENT_CONNECT_READY_TCP",
    0x22: "SERVER_CONNECT_REQUIRE", 0x23: "CLIENT_CONNECT_READY_REQUIRE",
    0x24: "CLIENT_HELLO", 0x25: "SERVER_HELLO",
}


def _captured_hello() -> bytes:
    return (Path(__file__).resolve().parent / "client_hello_10071.bin").read_bytes()


def _gen_rsa512():
    """Small dependency-free RSA-512 keygen (e=17) for the client side."""
    def is_prime(n):
        if n < 2:
            return False
        for p in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
            if n % p == 0:
                return n == p
        d, s = n - 1, 0
        while d % 2 == 0:
            d //= 2
            s += 1
        for _ in range(24):
            a = random.randrange(2, n - 2)
            x = pow(a, d, n)
            if x in (1, n - 1):
                continue
            for _ in range(s - 1):
                x = pow(x, 2, n)
                if x == n - 1:
                    break
            else:
                return False
        return True

    def prime(bits):
        while True:
            p = random.getrandbits(bits) | (1 << (bits - 1)) | 1
            if is_prime(p) and (p - 1) % 17:
                return p

    while True:
        p, q = prime(256), prime(256)
        n = p * q
        if n.bit_length() == 512:
            d = pow(17, -1, (p - 1) * (q - 1))
            return RSA(n, 17, d)


class Conn:
    def __init__(self, host, port):
        self.s = socket.create_connection((host, port), timeout=5)
        self.buf = b""
        self.rcq: RCQ | None = None
        self.log = []

    def send(self, mid, payload: bytes, cipher=None):
        if not payload:
            cipher = None  # SCE-RT never encrypts empty payloads
        if cipher is not None:
            c, h = cipher.encrypt(payload)
            pkt = bytes([mid | 0x80]) + struct.pack("<H", len(c)) + h + c
        else:
            pkt = bytes([mid]) + struct.pack("<H", len(payload)) + payload
        self.s.sendall(pkt)
        self.log.append(("C", mid, len(payload), cipher is not None))
        print("  C -> 0x%02x %-28s %4d B%s" % (mid, RT_NAMES.get(mid, "?"), len(payload),
                                                 " (enc)" if cipher else ""))

    def recv(self, rsa_for_peer: RSA | None = None):
        while True:
            if len(self.buf) >= 3:
                mid = self.buf[0]
                ln = struct.unpack("<H", self.buf[1:3])[0]
                enc = bool(mid & 0x80)
                hdr = 7 if enc else 3
                if len(self.buf) >= hdr + ln:
                    h = self.buf[3:7] if enc else b""
                    body = self.buf[hdr:hdr + ln]
                    self.buf = self.buf[hdr + ln:]
                    mid &= 0x7F
                    ok = True
                    if enc and not hash_is_empty(h):
                        ctx = h[3] >> 5
                        if ctx == 7 and rsa_for_peer is not None:
                            body, ok = rsa_for_peer.decrypt(body, h)
                        elif self.rcq is not None:
                            body, ok = self.rcq.decrypt(body, h)
                    self.log.append(("S", mid, ln, enc))
                    print("  S <- 0x%02x %-28s %4d B%s%s" % (
                        mid, RT_NAMES.get(mid, "?"), ln, " (enc)" if enc else "",
                        "" if ok else "  !! HASH MISMATCH"))
                    return mid, body
            chunk = self.s.recv(65536)
            if not chunk:
                raise ConnectionError("server closed the connection")
            self.buf += chunk

    def recv_until(self, wanted, rsa_for_peer=None, limit=10):
        for _ in range(limit):
            mid, body = self.recv(rsa_for_peer)
            if mid in wanted:
                return mid, body
        raise RuntimeError("did not receive %s" % wanted)


def handshake(host, port, session_key=b"", access_token=b"") -> Conn:
    c = Conn(host, port)
    c.send(0x24, _captured_hello())
    mid, cert = c.recv_until({0x25})
    server_n = int.from_bytes(cert[0x194:0x194 + 64], "big")
    assert server_n == SERVER_RSA.n, "server RSA modulus differs from the known SCERT key"

    me = _gen_rsa512()
    c.send(0x12, me.n.to_bytes(64, "little"), cipher=SERVER_RSA)
    mid, peer = c.recv_until({0x13}, rsa_for_peer=me)
    c.rcq = RCQ(peer[:64], RC_CLIENT_SESSION)

    body = struct.pack("<ii", 1, APP_ID) + me.n.to_bytes(64, "little")
    if session_key or access_token:
        body += session_key.ljust(17, b"\0")[:17] + access_token.ljust(17, b"\0")[:17]
    c.send(0x00, body, cipher=c.rcq)

    mid, _ = c.recv_until({0x07, 0x22, 0x06, 0x11})
    if mid == 0x22:
        c.send(0x23, b"", cipher=c.rcq)
        mid, _ = c.recv_until({0x07})
    c.send(0x21, struct.pack("<H", 0), cipher=c.rcq)
    c.recv_until({0x1a})
    return c


def medius_msg(cls: int, typ: int, body: bytes) -> bytes:
    return bytes([cls, typ]) + body


def msgid(s: str = "1") -> bytes:
    return s.encode().ljust(21, b"\0")


def test_muis(host, port):
    print("[muis] %s:%d" % (host, port))
    c = handshake(host, port)
    # MediusGetUniverseInformationRequest: class Lobby(1)? / type 0x76 is not assumed:
    # we send what Horizon's model expects, then print every reply.
    from medius_ids import LOBBY_CLASS, GET_UNIVERSE_INFORMATION
    info_filter = 0x1 | 0x2 | 0x4 | 0x8 | 0x10 | 0x20 | 0x40 | 0x80 | 0x100
    req = medius_msg(LOBBY_CLASS, GET_UNIVERSE_INFORMATION,
                     msgid("muis1") + b"\0" * 3 + struct.pack("<iii", info_filter, 0, 1))
    c.send(0x0b, req, cipher=c.rcq)
    c.s.settimeout(2)
    replies = []
    try:
        while True:
            mid, body = c.recv()
            replies.append(body)
            if mid == 0x0a:
                strings = [s for s in body.split(b"\0") if len(s) >= 4]
                print("       ", [s.decode("latin-1") for s in strings][:8])
    except (socket.timeout, ConnectionError):
        pass
    return c, replies


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "muis"
    host = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
    port = int(sys.argv[3]) if len(sys.argv) > 3 else 10071
    if which == "muis":
        test_muis(host, port)
    elif which == "handshake":
        handshake(host, port)
        print("handshake OK")
