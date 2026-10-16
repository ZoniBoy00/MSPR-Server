import { createSocket, RemoteInfo, Socket } from "node:dgram";
import net from "node:net";
import { advertisedIp, Config } from "../config.js";

/** Name from a DNS query starting at offset 12; returns [name, offset after QNAME]. */
export function readQName(msg: Buffer): [string, number] {
  const labels: string[] = [];
  let i = 12;
  while (i < msg.length && msg[i] !== 0) {
    const len = msg[i];
    labels.push(msg.subarray(i + 1, i + 1 + len).toString("latin1"));
    i += 1 + len;
  }
  return [labels.join(".").toLowerCase(), i + 1];
}

export function isLocalName(cfg: Config, name: string): boolean {
  return (cfg.svo.host !== "auto" && name === cfg.svo.host?.toLowerCase()) || cfg.dns.localNames.includes(name)
    || cfg.dns.localSuffixes.some((s) => name.endsWith(s));
}

export function canForward(cfg: Config, name: string): boolean {
  return (cfg.dns.forwardNames ?? []).some((domain) => name === domain || name.endsWith(`.${domain}`));
}

/** Answer for a local name: A record with our IP, empty NOERROR for other qtypes (AAAA ...). */
export function localAnswer(query: Buffer, ip: string): Buffer {
  const [, end] = readQName(query);
  const qtype = query.readUInt16BE(end);
  const question = query.subarray(12, end + 4);
  const isA = qtype === 1;
  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, 2); // id
  header.writeUInt16BE(0x8180 | (query.readUInt16BE(2) & 0x0100), 2); // response, RA, echo RD
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(isA ? 1 : 0, 6);
  if (!isA) return Buffer.concat([header, question]);
  const answer = Buffer.alloc(16);
  answer.writeUInt16BE(0xc00c, 0); // pointer to question name
  answer.writeUInt16BE(1, 2);       // A
  answer.writeUInt16BE(1, 4);       // IN
  answer.writeUInt32BE(60, 6);      // TTL
  answer.writeUInt16BE(4, 10);
  ip.split(".").forEach((o, k) => answer.writeUInt8(Number(o), 12 + k));
  return Buffer.concat([header, question, answer]);
}

/** SERVFAIL reply echoing the question (used when the upstream DNS does not answer). */
export function servFail(query: Buffer): Buffer {
  const [, end] = readQName(query);
  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, 2);
  header.writeUInt16BE(0x8182 | (query.readUInt16BE(2) & 0x0100), 2); // response, RA, rcode 2
  header.writeUInt16BE(1, 4);
  return Buffer.concat([header, query.subarray(12, end + 4)]);
}

function forward(cfg: Config, query: Buffer): Promise<Buffer | null> {
  return new Promise((done) => {
    const s = createSocket("udp4");
    const timer = setTimeout(() => { s.close(); done(null); }, 4000);
    s.on("message", (m, from) => {
      // only the upstream's answer to this very query counts (the socket is open to anybody who guesses its port)
      if (m.length < 12 || m.readUInt16BE(0) !== query.readUInt16BE(0) || (net.isIPv4(cfg.dns.upstream) && from.address !== cfg.dns.upstream)) return;
      clearTimeout(timer); s.close(); done(m);
    });
    s.on("error", () => { clearTimeout(timer); s.close(); done(null); });
    s.send(query, 53, cfg.dns.upstream);
  });
}

export function startDns(cfg: Config): Socket {
  const sock = createSocket("udp4");
  sock.on("message", async (q: Buffer, rinfo: RemoteInfo) => {
    try {
      // not a query (too short, or a response / reflection attempt, QR bit set, or no question): never answer it
      if (q.length < 17 || (q[2] & 0x80) !== 0 || q.readUInt16BE(4) < 1) return;
      const [name, end] = readQName(q);
      if (end + 4 > q.length) return;
      const qtype = q.readUInt16BE(end);
      if (isLocalName(cfg, name)) {
        const ip = advertisedIp(cfg);
        console.log(`[dns] ${name} (type ${qtype}) from ${rinfo.address} -> ${ip}`);
        sock.send(localAnswer(q, ip), rinfo.port, rinfo.address);
        return;
      }
      if (!canForward(cfg, name)) {
        console.log(`[dns] refusing upstream forwarding for ${name} from ${rinfo.address}`);
        sock.send(servFail(q), rinfo.port, rinfo.address);
        return;
      }
      // Answer every permitted query; the game's SVO resolver wedges if a lookup times out.
      const r = (await forward(cfg, q)) ?? servFail(q);
      sock.send(r, rinfo.port, rinfo.address);
    } catch (e) {
      console.error("[dns] bad query", e);
    }
  });
  sock.on("error", (e) => console.error(`[dns] ${e.message} (check bind address ${cfg.lanIp} and port ${cfg.dns.port})`));
  sock.bind(cfg.dns.port, cfg.lanIp, () => console.log(`[dns] listening on ${cfg.lanIp}:${cfg.dns.port}, local names -> ${advertisedIp(cfg)}`));
  return sock;
}
