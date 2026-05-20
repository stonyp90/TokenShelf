// Cache-hit gap detector.
//
// Anthropic and OpenAI both expose cache reads. If a project's effective cache
// hit ratio is below the median for its model family, surface a callout —
// caching often turns a 10x cost into a 1x cost.

import type { TokenReceipt } from "@prisma/client";

export type CacheStats = {
  totalInput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  hitRatio: number; // cacheRead / (cacheRead + uncachedInput)
  // Naive "would-have-saved" estimate: if hitRatio doubled, how many cents
  // would the project save? Uses the same heuristic as recommend-model.
  potentialSavingsCents: number;
  recommendation: string | null;
};

export function cacheStats(
  receipts: Pick<TokenReceipt, "inputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "costUsdCents" | "source">[],
): CacheStats {
  let totalInput = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let totalCost = 0;
  for (const r of receipts) {
    totalInput += r.inputTokens;
    cacheRead += r.cacheReadTokens;
    cacheWrite += r.cacheWriteTokens;
    totalCost += r.costUsdCents;
  }
  const inputUniverse = totalInput + cacheRead;
  const hitRatio = inputUniverse === 0 ? 0 : cacheRead / inputUniverse;

  // If we doubled cache hits, the additional read tokens replace input tokens
  // at ~10% the input rate (Anthropic) or ~50% (OpenAI). Mix and average to a
  // 25% effective discount on the affected slice.
  const potentialSavingsCents =
    inputUniverse === 0 || hitRatio >= 0.7
      ? 0
      : Math.round(totalCost * Math.min(0.4, (0.7 - hitRatio) * 0.75));

  let recommendation: string | null = null;
  if (hitRatio < 0.2 && inputUniverse > 100_000) {
    recommendation =
      "Cache hit ratio is below 20%. Structuring your prompts so the static prefix is shared could cut input cost by 60-80%.";
  } else if (hitRatio < 0.5 && inputUniverse > 1_000_000) {
    recommendation =
      "Cache hit ratio under 50% — there is likely still room. Move tool definitions and system prompts above the cache breakpoint.";
  }

  return { totalInput, totalCacheRead: cacheRead, totalCacheWrite: cacheWrite, hitRatio, potentialSavingsCents, recommendation };
}
