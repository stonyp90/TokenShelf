// Envelope encryption for at-rest provider secrets.
//
// MVP: the "KMS" is a single master key in env (`ENCRYPTION_KEY`, 32 bytes
// hex-encoded). Each row gets its own DEK (data encryption key) generated at
// write time; the DEK is wrapped with the master key via AES-256-GCM and
// stored alongside the ciphertext as JSON.
//
// Production: swap `unwrap()` / `wrap()` to call AWS KMS Decrypt / Encrypt,
// keeping the on-disk record format identical so we don't migrate.
//
// On-disk JSON (stored in ProviderConnection.secretCipher):
//
//   {
//     v: 1,                      // version
//     alg: "aes-256-gcm",
//     dekId: "local-v1",         // identifies how the DEK was wrapped
//     wrappedDek: "<b64>",       // DEK encrypted with master key
//     wrapIv: "<b64>",
//     wrapTag: "<b64>",
//     iv: "<b64>",               // payload IV
//     ct: "<b64>",               // payload ciphertext
//     tag: "<b64>"               // payload auth tag
//   }

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";

type EnvelopeRecord = {
  v: 1;
  alg: "aes-256-gcm";
  dekId: string;
  wrappedDek: string;
  wrapIv: string;
  wrapTag: string;
  iv: string;
  ct: string;
  tag: string;
};

function masterKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must be 32 bytes hex (got ${buf.length}).`);
  }
  return buf;
}

function aesGcmEncrypt(key: Buffer, plaintext: Buffer): { iv: Buffer; ct: Buffer; tag: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, ct, tag };
}

function aesGcmDecrypt(key: Buffer, iv: Buffer, ct: Buffer, tag: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export function encryptSecret(plaintext: string): EnvelopeRecord {
  const master = masterKey();
  const dek = randomBytes(32);
  const wrapped = aesGcmEncrypt(master, dek);
  const payload = aesGcmEncrypt(dek, Buffer.from(plaintext, "utf8"));
  return {
    v: 1,
    alg: "aes-256-gcm",
    dekId: "local-v1",
    wrappedDek: wrapped.ct.toString("base64"),
    wrapIv: wrapped.iv.toString("base64"),
    wrapTag: wrapped.tag.toString("base64"),
    iv: payload.iv.toString("base64"),
    ct: payload.ct.toString("base64"),
    tag: payload.tag.toString("base64"),
  };
}

export function decryptSecret(record: EnvelopeRecord | Prisma.JsonValue): string {
  const r = record as EnvelopeRecord;
  if (!r || r.v !== 1 || r.alg !== "aes-256-gcm") {
    throw new Error("envelope: unsupported record");
  }
  const master = masterKey();
  const dek = aesGcmDecrypt(
    master,
    Buffer.from(r.wrapIv, "base64"),
    Buffer.from(r.wrappedDek, "base64"),
    Buffer.from(r.wrapTag, "base64"),
  );
  const pt = aesGcmDecrypt(
    dek,
    Buffer.from(r.iv, "base64"),
    Buffer.from(r.ct, "base64"),
    Buffer.from(r.tag, "base64"),
  );
  return pt.toString("utf8");
}

/**
 * Generate a fresh master key. Run once, store in `ENCRYPTION_KEY` env.
 */
export function generateMasterKey(): string {
  return randomBytes(32).toString("hex");
}
