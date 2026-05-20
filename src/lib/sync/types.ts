import type { ProviderKind } from "@prisma/client";

/** A normalised receipt produced by any provider adapter. */
export type UnifiedReceipt = {
  source: ProviderKind;
  model: string;
  serviceTier?: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsdCents: number; // computed locally from pricing/* tables
  occurredAt: Date;
  externalId: string; // provider's request_id or row id; uniqueness key
  raw: unknown; // canonicalised before hashing in the orchestrator
};

export type SyncRange = { since: Date; until: Date };

export interface ProviderSyncAdapter {
  kind: ProviderKind;
  /** Pull receipts in [since, until). Yields unified receipts. */
  pull(opts: { secret: string; since: Date; until: Date }): AsyncIterable<UnifiedReceipt>;
  /**
   * Optional one-off action — used for things like GitHub repo verification
   * that aren't periodic usage pulls.
   */
  verify?(opts: { secret: string }): Promise<{ ok: boolean; meta?: unknown }>;
}

export class AdapterError extends Error {
  constructor(message: string, public status?: number, public body?: unknown) {
    super(message);
    this.name = "AdapterError";
  }
}

export async function* paged<T>(
  fetchPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>,
  limit = 50,
): AsyncIterable<T> {
  let cursor: string | null = null;
  for (let i = 0; i < limit; i++) {
    const page = await fetchPage(cursor);
    for (const item of page.items) yield item;
    if (!page.nextCursor) return;
    cursor = page.nextCursor;
  }
}
