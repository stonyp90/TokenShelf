// Pricing tables. Keep the on-disk format simple so a future cron can refresh
// these against provider rate cards.
//
// All rates are USD per *million* tokens, by category. cost() returns USD
// cents (integer) to keep aggregates exact.

import { anthropicPricing } from "./anthropic";
import { openaiPricing } from "./openai";
import { googlePricing } from "./google";
import { azureOpenAIPricing } from "./azure-openai";
import { replicatePricing } from "./replicate";
import { bedrockPricing } from "./bedrock";

export type Rate = {
  inputPerMtok: number;
  outputPerMtok: number;
  cacheReadPerMtok?: number;
  cacheWritePerMtok?: number;
  /** "standard" | "batch" | "scale" | provider-specific */
  serviceTier?: string;
};

export type PricingTable = Record<string /* canonical model id */, Rate[]>;

const TABLES: Record<string, PricingTable> = {
  ANTHROPIC: anthropicPricing,
  OPENAI: openaiPricing,
  GOOGLE: googlePricing,
  AZURE_OPENAI: azureOpenAIPricing,
  REPLICATE: replicatePricing,
  BEDROCK: bedrockPricing,
};

export type SupportedProvider = keyof typeof TABLES;

export type CostInput = {
  provider: SupportedProvider;
  model: string;
  serviceTier?: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export function priceLookup(
  provider: SupportedProvider,
  model: string,
  serviceTier: string | null = null,
): Rate | undefined {
  const table = TABLES[provider];
  if (!table) return undefined;
  const candidates = table[model];
  if (!candidates) return undefined;
  if (serviceTier) {
    const t = candidates.find((r) => r.serviceTier === serviceTier);
    if (t) return t;
  }
  return candidates.find((r) => !r.serviceTier) ?? candidates[0];
}

/** Returns USD cents (integer, rounded). */
export function cost(input: CostInput): number {
  const rate = priceLookup(input.provider, input.model, input.serviceTier ?? null);
  if (!rate) return 0;
  const M = 1_000_000;
  let dollars = 0;
  dollars += (input.inputTokens / M) * rate.inputPerMtok;
  dollars += (input.outputTokens / M) * rate.outputPerMtok;
  if (input.cacheReadTokens && rate.cacheReadPerMtok) {
    dollars += (input.cacheReadTokens / M) * rate.cacheReadPerMtok;
  }
  if (input.cacheWriteTokens && rate.cacheWritePerMtok) {
    dollars += (input.cacheWriteTokens / M) * rate.cacheWritePerMtok;
  }
  return Math.round(dollars * 100);
}

/** All canonical models we know about, for the recommender / UI. */
export function knownModels(provider: SupportedProvider): string[] {
  return Object.keys(TABLES[provider] ?? {});
}

export function isSupportedProvider(p: string): p is SupportedProvider {
  return p in TABLES;
}
