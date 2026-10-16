import { createHash, createPublicKey, createVerify, KeyObject } from "node:crypto";

/**
 * Signature check of an NP (XI5) ticket, the same rules Horizon applies at the Medius login (XI5Ticket.cs):
 *  - RPCN tickets (signer "RPCN"): ECDSA secp224k1 over SHA-224 of the whole body field, with RPCN's public key
 *  - PSN tickets (a real PS3): ECDSA secp192r1 over SHA-1 of everything before the signature, with the PSN signing key
 * The signature in the footer is a DER sequence (PSN may append stray bytes, which are cut off like Horizon does).
 */
export type TicketCheck = { signer: "rpcn" | "psn" | "unknown"; valid: boolean | null; reason: string };

const RPCN_KEY = createPublicKey(
  "-----BEGIN PUBLIC KEY-----\nME4wEAYHKoZIzj0CAQYFK4EEACADOgAEsHvA8K3bl2V+nziQOejSucl9wqMdMELn\n0Eebk9gcQrCr32xCGRox4x+TNC+PAzvVKcLFf9taCn0=\n-----END PUBLIC KEY-----");

/** secp192r1 (prime192v1) public key from its point coordinates, as a SubjectPublicKeyInfo. */
function p192Key(xHex: string, yHex: string): KeyObject {
  const head = Buffer.from("3049301306072a8648ce3d020106082a8648ce3d030101033200", "hex");
  return createPublicKey({ key: Buffer.concat([head, Buffer.from("04" + xHex + yHex, "hex")]), format: "der", type: "spki" });
}
/** MotorStorm's PSN tickets are signed with Sony's default title key (the one Horizon uses). */
const PSN_KEYS = [p192Key("39c62d061d4ee35c5f3f7531de0af3cf918346526edac727", "a5d578b55113e612bf1878d4cc939d61a41318403b5bdf86")];

/** DER sequence of two integers, with up to two stray trailing bytes removed; null if it is not one. */
function derSignature(sig: Buffer): Buffer | null {
  for (let cut = 0; cut <= 2 && sig.length - cut > 8; cut++) {
    const d = sig.subarray(0, sig.length - cut);
    if (d[0] === 0x30 && d[1] === d.length - 2) return d;
  }
  return null;
}

function verify(alg: "sha224" | "sha1", message: Buffer, sig: Buffer, key: KeyObject): boolean {
  try { return createVerify(alg).update(message).verify({ key, dsaEncoding: "der" }, sig); } catch { return false; }
}

export function checkTicket(blob: Buffer, keys: { rpcn?: KeyObject; psn?: KeyObject[] } = {}): TicketCheck {
  try {
    if (blob.length < 20) return { signer: "unknown", valid: null, reason: "too short" };
    if (blob[0] >> 4 === 4) return { signer: "unknown", valid: null, reason: "ticket version 4 is not checked" };   // as in Horizon: unhandled hash
    const size = blob.readUInt16BE(6);
    if (blob.readUInt16BE(8) !== 0x3000) return { signer: "unknown", valid: null, reason: "no body field" };
    const bodyEnd = 8 + 4 + blob.readUInt16BE(10);
    if (blob.length < bodyEnd + 4 || 8 + size > blob.length) return { signer: "unknown", valid: null, reason: "truncated" };
    if (blob.readUInt16BE(bodyEnd) !== 0x3002) return { signer: "unknown", valid: null, reason: "no footer" };
    const footer = blob.subarray(bodyEnd + 4, bodyEnd + 4 + blob.readUInt16BE(bodyEnd + 2));
    // footer = binary field (signer id) followed by binary field (signature), each with a 4-byte type+size header
    const idLen = footer.readUInt16BE(2);
    const id = footer.subarray(4, 4 + idLen);
    const sigLen = footer.readUInt16BE(4 + idLen + 2);
    const sig = footer.subarray(4 + idLen + 4, 4 + idLen + 4 + sigLen);
    const signer = id.subarray(0, id.indexOf(0) >= 0 ? id.indexOf(0) : id.length).toString("utf8");
    if (signer.toUpperCase() === "RPCN") {
      const der = derSignature(sig);
      if (!der) return { signer: "rpcn", valid: false, reason: "bad signature encoding" };
      const ok = verify("sha224", blob.subarray(8, bodyEnd), der, keys.rpcn ?? RPCN_KEY);
      return { signer: "rpcn", valid: ok, reason: ok ? "ok" : "RPCN signature does not match" };
    }
    if (sig.length === 56) {
      const der = derSignature(sig);
      if (!der) return { signer: "psn", valid: false, reason: "bad signature encoding" };
      const at = blob.indexOf(sig);
      const message = blob.subarray(0, at);
      const ok = at > 0 && (keys.psn ?? PSN_KEYS).some((k) => verify("sha1", message, der, k));
      return { signer: "psn", valid: ok, reason: ok ? "ok" : "PSN signature does not match" };
    }
    return { signer: "unknown", valid: null, reason: `signature of ${sig.length} bytes not handled` };
  } catch (e) {
    return { signer: "unknown", valid: null, reason: `unreadable: ${(e as Error).message}` };
  }
}

/** Hash used only to show that two tickets are the same without logging them. */
export const ticketFingerprint = (blob: Buffer) => createHash("sha1").update(blob).digest("hex").slice(0, 8);
