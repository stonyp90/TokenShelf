// Receipt signing.
//
// When a sync worker imports a verified receipt, it:
//   1. Canonicalises the raw provider row.
//   2. Hashes it with SHA-256 → `responseHash`.
//   3. Signs `responseHash || externalId` with our ed25519 key.
//
// A third party can independently verify a receipt by pulling our public key
// from /.well-known/tokenshelf-verify.json and re-running the same hash.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
} from "node:crypto";

const SIGNER_KEY_ID = "tks-sig-1";

function privateKey() {
  const raw = process.env.SIGNING_PRIVATE_KEY;
  if (!raw) {
    throw new Error(
      "SIGNING_PRIVATE_KEY is not set. Generate with: node -e \"const k=require('crypto').generateKeyPairSync('ed25519');console.log(k.privateKey.export({type:'pkcs8',format:'pem'}))\"",
    );
  }
  // .env loaders preserve literal `\n` escapes; PEMs need real newlines.
  // Accept both formats so the env var can be stored either way.
  const pem = raw.includes("\\n") && !raw.includes("\n") ? raw.replaceAll("\\n", "\n") : raw;
  return createPrivateKey(pem);
}

export function publicKeyPem(): string {
  const pub = createPublicKey(privateKey());
  return pub.export({ type: "spki", format: "pem" }).toString();
}

export function canonicalize(obj: unknown): string {
  // Deterministic JSON: sorted keys, no whitespace. Good enough for receipts;
  // for hostile-input scenarios consider RFC 8785.
  const seen = new WeakSet<object>();
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) return null;
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(norm);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      out[k] = norm((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return JSON.stringify(norm(obj));
}

export function hashRow(row: unknown): string {
  return "sha256:" + createHash("sha256").update(canonicalize(row)).digest("hex");
}

export function signReceipt(input: { responseHash: string; externalId: string }): {
  signature: string;
  signerKeyId: string;
} {
  const data = Buffer.from(`${input.responseHash}|${input.externalId}`, "utf8");
  const sig = nodeSign(null, data, privateKey()).toString("base64");
  return { signature: sig, signerKeyId: SIGNER_KEY_ID };
}

export function verifyReceipt(input: {
  responseHash: string;
  externalId: string;
  signature: string;
  publicKey: ReturnType<typeof createPublicKey>;
}): boolean {
  const data = Buffer.from(`${input.responseHash}|${input.externalId}`, "utf8");
  return nodeVerify(null, data, input.publicKey, Buffer.from(input.signature, "base64"));
}

/** Generate a fresh ed25519 keypair. Run once. */
export function generateSigningKeypair(): { privateKey: string; publicKey: string } {
  const k = generateKeyPairSync("ed25519");
  return {
    privateKey: k.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: k.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

export { SIGNER_KEY_ID };
