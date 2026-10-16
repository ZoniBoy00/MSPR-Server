import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { checkTicket } from "../src/svo/ticket.js";

// Builds a version 2.1 ticket laid out like the game's: 8-byte header, body field (0x3000), footer (0x3002) holding signer id + signature.
const field = (type: number, data: Buffer) => Buffer.concat([Buffer.from([type >> 8, type & 255, data.length >> 8, data.length & 255]), data]);
function ticket(signer: string, sign: (message: Buffer) => Buffer, tamper = false): Buffer {
  const body = field(0x3000, Buffer.from(tamper ? "player-one!" : "player-one-"));
  const head = (len: number) => Buffer.from([0x21, 0x01, 0, 0, 0, 0, len >> 8, len & 255]);
  const idField = field(8, Buffer.from(signer));
  // the signed message differs per network: RPCN signs the body field, PSN everything before the signature
  const sig = sign(signer === "RPCN" ? Buffer.from(field(0x3000, Buffer.from("player-one-"))) : Buffer.concat([head(0), Buffer.from(body)]));
  const footer = field(0x3002, Buffer.concat([idField, field(8, sig)]));
  return Buffer.concat([head(body.length + footer.length), body, footer]);
}

test("an RPCN-signed ticket verifies, a changed one does not", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "secp224k1" });
  const sign = (m: Buffer) => createSign("sha224").update(m).sign({ key: privateKey, dsaEncoding: "der" });
  assert.deepEqual(checkTicket(ticket("RPCN", sign), { rpcn: publicKey }), { signer: "rpcn", valid: true, reason: "ok" });
  const bad = checkTicket(ticket("RPCN", sign, true), { rpcn: publicKey });
  assert.equal(bad.valid, false);
});

test("garbage is reported as unreadable, never as valid", () => {
  assert.equal(checkTicket(Buffer.alloc(300, 7)).valid === true, false);
  assert.equal(checkTicket(Buffer.alloc(3)).valid, null);
});
