// Personal Access Tokens for programmatic /api/receipts.
//
// Format:    tks_<base64url(rand 32 bytes)>
// Prefix:    first 12 chars of the token (e.g. "tks_a8Fz3xyZ") — stored
//            plaintext so users can identify a token in the UI.
// Storage:   only sha256(token) hex is persisted. The full token is shown to
//            the user exactly once at mint time.

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

const PREFIX_LEN = 12;

export type MintedPat = {
  id: string;
  token: string; // shown to the user once
  prefix: string;
  scopes: string[];
  projectId: string | null;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): { token: string; prefix: string } {
  // 32 random bytes → 43 chars base64url; total length 47 incl. "tks_".
  const raw = randomBytes(32).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const token = `tks_${raw}`;
  return { token, prefix: token.slice(0, PREFIX_LEN) };
}

export async function mintPat(input: {
  userId: string;
  name: string;
  projectId?: string | null;
  scopes?: string[];
}): Promise<MintedPat> {
  const { token, prefix } = newToken();
  const hash = hashToken(token);
  const row = await prisma.personalAccessToken.create({
    data: {
      userId: input.userId,
      name: input.name.slice(0, 60),
      prefix,
      hash,
      projectId: input.projectId ?? undefined,
      scopes: input.scopes && input.scopes.length > 0 ? input.scopes : ["receipts:write"],
    },
  });
  return { id: row.id, token, prefix, scopes: row.scopes, projectId: row.projectId };
}

/**
 * Look up a PAT by token string. Returns the token row (and its owning user)
 * iff the hash matches and the token isn't revoked. Updates lastUsedAt.
 */
export async function resolvePat(token: string): Promise<{
  userId: string;
  projectId: string | null;
  scopes: string[];
  tokenId: string;
} | null> {
  if (!token.startsWith("tks_") || token.length < PREFIX_LEN + 8) return null;
  const prefix = token.slice(0, PREFIX_LEN);
  const hash = hashToken(token);
  const row = await prisma.personalAccessToken.findFirst({
    where: { prefix, hash, revokedAt: null },
  });
  if (!row) return null;
  // Fire-and-forget last-used update.
  prisma.personalAccessToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
  return {
    userId: row.userId,
    projectId: row.projectId,
    scopes: row.scopes,
    tokenId: row.id,
  };
}

export async function revokePat(args: { userId: string; tokenId: string }) {
  await prisma.personalAccessToken.updateMany({
    where: { id: args.tokenId, userId: args.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
