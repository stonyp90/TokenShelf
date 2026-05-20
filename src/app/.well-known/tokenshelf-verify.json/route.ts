import { NextResponse } from "next/server";
import { SIGNER_KEY_ID, publicKeyPem } from "@/lib/crypto/sign";

// Publishes our signing public key so third parties can verify receipts.
//
// Example:
//   curl https://tokenshelf.dev/.well-known/tokenshelf-verify.json
//
// {
//   "keys": [
//     { "id": "tks-sig-1", "alg": "ed25519", "publicKeyPem": "-----BEGIN PUBLIC KEY-----…" }
//   ],
//   "verifyAlgorithm": "ed25519(responseHash + '|' + externalId)"
// }

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(
      {
        keys: [{ id: SIGNER_KEY_ID, alg: "ed25519", publicKeyPem: publicKeyPem() }],
        verifyAlgorithm: "ed25519(responseHash + '|' + externalId)",
      },
      { headers: { "cache-control": "public, max-age=300" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: "signing_not_configured", detail: (e as Error).message },
      { status: 503 },
    );
  }
}
