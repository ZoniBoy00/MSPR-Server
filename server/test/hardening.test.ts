import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { request } from "node:http";
import { after, before, describe, test } from "node:test";
import { loadConfig, Config } from "../src/config.js";
import { Store } from "../src/db/store.js";
import { startDns } from "../src/dns/server.js";
import { cleanOnlineId, startSvo } from "../src/svo/server.js";

// Abuse cases for the public ports. MSPR_TRUST_ACCT_COOKIE is deliberately NOT set here (svo.test.ts sets it for the replays).

const PORT = 10162;
let cfg: Config;
let server: ReturnType<typeof startSvo>;
const store = new Store(":memory:");

function http(method: string, path: string, headers: Record<string, string> = {}, body: Buffer = Buffer.alloc(0)) {
  return new Promise<{ status: number; body: string; cookie?: string }>((done, fail) => {
    const req = request({ host: "127.0.0.1", port: PORT, method, path, headers: { ...headers, "Content-Length": body.length } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => done({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), cookie: res.headers["set-cookie"]?.[0] }));
    });
    req.on("error", fail);
    req.end(body);
  });
}

before(async () => {
  cfg = await loadConfig();
  cfg.svo.port = PORT;
  server = startSvo(cfg, store);
  await new Promise((r) => server.once("listening", r));
});
after(() => server.close());

describe("SVO identity", () => {
  test("an AcctID cookie does not make a request come from that account", async () => {
    const before = (store.db.prepare("SELECT COUNT(*) AS n FROM races").get() as { n: number }).n;
    await http("POST", "/motorstormpr/finishGame?location.gameMode=9&location.track=2&location.vehicle=4&bestTime=9000&endNormal=1",
      { Cookie: "AcctName=Victim; AcctID=61025", "Content-Type": "application/x-www-form-urlencoded" });
    assert.equal((store.db.prepare("SELECT COUNT(*) AS n FROM races").get() as { n: number }).n, before);
    const eula = await http("GET", "/motorstormpr/acceptEula", { Cookie: "AcctName=Victim; AcctID=61025" });
    assert.equal(eula.status, 200);            // answered like before, but nobody's EULA state changed
  });

  test("a malformed id in a result is dropped, nothing reaches the boards", async () => {
    const login = await http("POST", "/motorstormpr/https:ticket/login", {}, Buffer.alloc(0));
    const session = /AuthKeyTime=[^;]+/.exec(login.cookie ?? "")![0];
    const n = () => (store.db.prepare("SELECT COUNT(*) AS n FROM races").get() as { n: number }).n;
    const before = n();
    const evil = encodeURIComponent('4"/><x a="');
    await http("POST", `/motorstormpr/finishGame?location.gameMode=9&location.track=2&location.vehicle=${evil}&bestTime=9000&endNormal=1`, { Cookie: session });
    assert.equal(n(), before);
    await http("POST", "/motorstormpr/finishGame?location.gameMode=9&location.track=2&location.vehicle=4&bestTime=9000&endNormal=1", { Cookie: session });
    assert.equal(n(), before + 1);             // a normal result still counts
  });

  test("a body over the limit is refused", async () => {
    const r = await http("POST", "/motorstormpr/finishGame?location.gameMode=9", {}, Buffer.alloc(600 * 1024, 1)).catch(() => ({ status: 0 }));
    assert.ok(r.status === 413 || r.status === 0, `status ${r.status}`);   // 0 = the socket was cut before the answer was read
    assert.equal((await http("GET", "/motorstormpr/getRegion")).status, 200);   // and the service is still up
  });

  test("online ids carry only the characters the networks allow", () => {
    assert.equal(cleanOnlineId("Bob@PSN"), "BobPSN");
    assert.equal(cleanOnlineId("a\nb"), "");
    assert.equal(cleanOnlineId("Zoni_Boy-0"), "Zoni_Boy-0");
    assert.equal(cleanOnlineId("x".repeat(40)), "x".repeat(16));
    assert.equal(cleanOnlineId(undefined), "");
  });
});

describe("DNS", () => {
  test("a response packet (QR set) is never answered, a real query is", async () => {
    const sock = startDns({ ...cfg, lanIp: "127.0.0.1", dns: { ...cfg.dns, port: 0, localNames: ["svo.test"] } });
    await new Promise<void>((done) => sock.once("listening", () => done()));
    const port = sock.address().port;
    const query = (flags: number) => Buffer.concat([Buffer.from([0x12, 0x34, flags, 0, 0, 1, 0, 0, 0, 0, 0, 0, 3, 115, 118, 111, 4, 116, 101, 115, 116, 0, 0, 1, 0, 1])]);
    const ask = (q: Buffer, ms: number) => new Promise<Buffer | null>((done) => {
      const c = createSocket("udp4");
      const t = setTimeout(() => { c.close(); done(null); }, ms);
      c.on("message", (m) => { clearTimeout(t); c.close(); done(m); });
      c.send(q, port, "127.0.0.1");
    });
    try {
      assert.equal(await ask(query(0x80), 300), null);
      const ok = await ask(query(0x01), 1000);
      assert.ok(ok && ok.length > 12);
    } finally { sock.close(); }
  });
});
