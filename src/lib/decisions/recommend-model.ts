// Model recommender.
//
// Given a project's receipts, estimate per-model cost across all candidate
// models in the same provider family. Output a ranked list so the project page
// can show "you would have paid $X on Y instead".
//
// Heuristic, not ML: we assume the *workload shape* (in/out/cache ratios)
// stays the same when swapping models. The recommender doesn't claim quality
// parity — that's what the eval tab is for in M2.

import type { ProviderKind, TokenReceipt } from "@prisma/client";
import { cost, knownModels } from "@/lib/pricing";

export type ModelRecommendation = {
  model: string;
  estimatedCostUsdCents: number;
  deltaUsdCents: number; // negative = cheaper than current
  deltaPct: number; // negative = cheaper than current
};

export function recommendModels(input: {
  receipts: Pick<
    TokenReceipt,
    "source" | "model" | "serviceTier" | "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "costUsdCents"
  >[];
  provider: ProviderKind & ("ANTHROPIC" | "OPENAI");
  /** Filter recommendations to only models in the same family (opus/sonnet/haiku, etc.). */
  family?: "opus" | "sonnet" | "haiku" | "gpt-4o" | "o1" | null;
}): { current: { totalCostUsdCents: number; primaryModel: string }; recommendations: ModelRecommendation[] } {
  const matching = input.receipts.filter((r) => r.source === input.provider);
  if (matching.length === 0) {
    return { current: { totalCostUsdCents: 0, primaryModel: "" }, recommendations: [] };
  }

  const byModel = new Map<string, number>();
  let totalCost = 0;
  for (const r of matching) {
    totalCost += r.costUsdCents;
    byModel.set(r.model, (byModel.get(r.model) ?? 0) + r.costUsdCents);
  }
  const primary = [...byModel.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

  const candidates = knownModels(input.provider).filter((m) => {
    if (!input.family) return true;
    return m.toLowerCase().includes(input.family);
  });

  const recs: ModelRecommendation[] = candidates.map((m) => {
    let estimated = 0;
    for (const r of matching) {
      estimated += cost({
        provider: input.provider,
        model: m,
        serviceTier: r.serviceTier ?? null,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        cacheWriteTokens: r.cacheWriteTokens,
      });
    }
    const delta = estimated - totalCost;
    return {
      model: m,
      estimatedCostUsdCents: estimated,
      deltaUsdCents: delta,
      deltaPct: totalCost > 0 ? (delta / totalCost) * 100 : 0,
    };
  });

  return {
    current: { totalCostUsdCents: totalCost, primaryModel: primary },
    recommendations: recs.sort((a, b) => a.estimatedCostUsdCents - b.estimatedCostUsdCents),
  };
}
