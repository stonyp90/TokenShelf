// Sync orchestrator.
//
// Responsibilities:
//   - Resolve a user's ProviderConnection for a given kind.
//   - Decrypt the stored secret via envelope encryption.
//   - Run the right adapter for the [since, until) range.
//   - Write receipts with TrustTier=VERIFIED, sign each one, recompute the
//     project aggregates.
//   - Update lastSyncedAt + lastSyncCursor on the connection.

import { Prisma, type ProviderKind, type Project } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto/envelope";
import { hashRow, signReceipt } from "@/lib/crypto/sign";
import { anthropicAdapter } from "./anthropic";
import { openaiAdapter } from "./openai";
import { githubAdapter, verifyRepoAccess } from "./github";
import { googleAdapter } from "./google";
import { replicateAdapter } from "./replicate";
import { azureOpenAIAdapter } from "./azure-openai";
import type { ProviderSyncAdapter, UnifiedReceipt } from "./types";
import { audit } from "@/lib/audit";

const ADAPTERS: Partial<Record<ProviderKind, ProviderSyncAdapter>> = {
  ANTHROPIC: anthropicAdapter,
  OPENAI: openaiAdapter,
  GITHUB: githubAdapter,
  GOOGLE: googleAdapter,
  REPLICATE: replicateAdapter,
  AZURE_OPENAI: azureOpenAIAdapter,
};

export type SyncSummary = {
  ok: boolean;
  kind: ProviderKind;
  projectId: string;
  inserted: number;
  skipped: number;
  errors: string[];
  windowSince: string;
  windowUntil: string;
};

export async function syncProvider(args: {
  userId: string;
  projectId: string;
  kind: ProviderKind;
  since?: Date;
  until?: Date;
}): Promise<SyncSummary> {
  const adapter = ADAPTERS[args.kind];
  const now = new Date();
  const summary: SyncSummary = {
    ok: false,
    kind: args.kind,
    projectId: args.projectId,
    inserted: 0,
    skipped: 0,
    errors: [],
    windowSince: "",
    windowUntil: now.toISOString(),
  };
  if (!adapter) {
    summary.errors.push("unsupported_provider");
    return summary;
  }

  const conn = await prisma.providerConnection.findFirst({
    where: { userId: args.userId, kind: args.kind },
  });
  if (!conn?.secretCipher) {
    summary.errors.push("no_provider_connection");
    return summary;
  }
  const project = await prisma.project.findFirst({
    where: { id: args.projectId, ownerId: args.userId },
  });
  if (!project) {
    summary.errors.push("project_not_found");
    return summary;
  }

  let secret: string;
  try {
    secret = decryptSecret(conn.secretCipher as Prisma.JsonObject);
  } catch (e) {
    summary.errors.push(`decrypt_failed: ${(e as Error).message}`);
    return summary;
  }

  const since = args.since ?? conn.lastSyncedAt ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const until = args.until ?? now;
  summary.windowSince = since.toISOString();
  summary.windowUntil = until.toISOString();

  await audit({
    userId: args.userId,
    action: `sync.${args.kind.toLowerCase()}.start`,
    target: project.id,
    meta: { since: summary.windowSince, until: summary.windowUntil },
    success: true,
  });

  let totalInsertedDelta = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    receipts: 0,
  };

  try {
    for await (const u of adapter.pull({ secret, since, until })) {
      const inserted = await persistReceipt(project, u);
      if (inserted) {
        summary.inserted++;
        totalInsertedDelta.inputTokens += u.inputTokens;
        totalInsertedDelta.outputTokens += u.outputTokens;
        totalInsertedDelta.cacheReadTokens += u.cacheReadTokens ?? 0;
        totalInsertedDelta.cacheWriteTokens += u.cacheWriteTokens ?? 0;
        totalInsertedDelta.cost += u.costUsdCents;
        totalInsertedDelta.receipts += 1;
      } else {
        summary.skipped++;
      }
    }
  } catch (e) {
    const msg = (e as Error).message;
    summary.errors.push(msg);
    await audit({
      userId: args.userId,
      action: `sync.${args.kind.toLowerCase()}.error`,
      target: project.id,
      meta: { message: msg },
      success: false,
      error: msg,
    });
  }

  if (totalInsertedDelta.receipts > 0) {
    await prisma.project.update({
      where: { id: project.id },
      data: {
        totalInputTokens: { increment: totalInsertedDelta.inputTokens },
        totalOutputTokens: { increment: totalInsertedDelta.outputTokens },
        totalCacheReadTokens: { increment: totalInsertedDelta.cacheReadTokens },
        totalCacheWriteTokens: { increment: totalInsertedDelta.cacheWriteTokens },
        totalCostUsdCents: { increment: totalInsertedDelta.cost },
        receiptCount: { increment: totalInsertedDelta.receipts },
        verifiedReceiptCount: { increment: totalInsertedDelta.receipts },
      },
    });
  }

  await prisma.providerConnection.update({
    where: { id: conn.id },
    data: { lastSyncedAt: until },
  });

  summary.ok = summary.errors.length === 0;
  await audit({
    userId: args.userId,
    action: `sync.${args.kind.toLowerCase()}.complete`,
    target: project.id,
    meta: { inserted: summary.inserted, skipped: summary.skipped },
    success: summary.ok,
    error: summary.errors[0],
  });
  return summary;
}

async function persistReceipt(project: Project, u: UnifiedReceipt): Promise<boolean> {
  const responseHash = hashRow(u.raw);
  const { signature, signerKeyId } = signReceipt({
    responseHash,
    externalId: u.externalId,
  });
  try {
    await prisma.tokenReceipt.create({
      data: {
        projectId: project.id,
        source: u.source,
        model: u.model,
        serviceTier: u.serviceTier ?? undefined,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadTokens ?? 0,
        cacheWriteTokens: u.cacheWriteTokens ?? 0,
        costUsdCents: u.costUsdCents,
        occurredAt: u.occurredAt,
        externalId: u.externalId,
        trustTier: "VERIFIED",
        responseHash,
        signature,
        signerKeyId,
        raw: u.raw === undefined ? undefined : (u.raw as object),
      },
    });
    return true;
  } catch (e) {
    // Idempotent: unique violation on (source, externalId) means we already
    // ingested this row. Anything else: rethrow.
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      (e as { code: string }).code === "P2002"
    ) {
      return false;
    }
    throw e;
  }
}

export async function syncAllForUser(userId: string): Promise<SyncSummary[]> {
  // Each connection × each user's project — only run for projects whose owner
  // has explicitly attached the connection. For now we assume the user's
  // "default" connection applies to all their projects. Future: per-project
  // connection mapping.
  const conns = await prisma.providerConnection.findMany({ where: { userId } });
  const projects = await prisma.project.findMany({ where: { ownerId: userId } });
  const out: SyncSummary[] = [];
  for (const c of conns) {
    if (!(c.kind in ADAPTERS)) continue;
    if (c.kind === "GITHUB") continue; // not a usage source
    for (const p of projects) {
      out.push(await syncProvider({ userId, projectId: p.id, kind: c.kind }));
    }
  }
  return out;
}

export { verifyRepoAccess };
