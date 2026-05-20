// Anthropic rate card.
//
// Rates: USD per million tokens.
// Cache reads price at 10% of input; cache writes at 125% of input
// (per Anthropic's prompt-caching docs). The recommender uses these to
// estimate the effective rate at a given cache-hit ratio.
//
// Refresh strategy (M2+): a weekly job parses the public pricing page and
// updates this file via PR.

import type { PricingTable } from "./index";

export const anthropicPricing: PricingTable = {
  // Claude 4.x family (current generation)
  "claude-opus-4-7": [
    {
      inputPerMtok: 15.0,
      outputPerMtok: 75.0,
      cacheReadPerMtok: 1.5,
      cacheWritePerMtok: 18.75,
    },
    {
      serviceTier: "batch",
      inputPerMtok: 7.5,
      outputPerMtok: 37.5,
      cacheReadPerMtok: 0.75,
      cacheWritePerMtok: 9.375,
    },
  ],
  "claude-sonnet-4-6": [
    {
      inputPerMtok: 3.0,
      outputPerMtok: 15.0,
      cacheReadPerMtok: 0.3,
      cacheWritePerMtok: 3.75,
    },
    {
      serviceTier: "batch",
      inputPerMtok: 1.5,
      outputPerMtok: 7.5,
      cacheReadPerMtok: 0.15,
      cacheWritePerMtok: 1.875,
    },
  ],
  "claude-haiku-4-5": [
    {
      inputPerMtok: 0.8,
      outputPerMtok: 4.0,
      cacheReadPerMtok: 0.08,
      cacheWritePerMtok: 1.0,
    },
    {
      serviceTier: "batch",
      inputPerMtok: 0.4,
      outputPerMtok: 2.0,
      cacheReadPerMtok: 0.04,
      cacheWritePerMtok: 0.5,
    },
  ],
  // Legacy aliases sync workers might encounter
  "claude-3-5-sonnet-20241022": [
    { inputPerMtok: 3.0, outputPerMtok: 15.0, cacheReadPerMtok: 0.3, cacheWritePerMtok: 3.75 },
  ],
  "claude-3-5-haiku-20241022": [
    { inputPerMtok: 0.8, outputPerMtok: 4.0, cacheReadPerMtok: 0.08, cacheWritePerMtok: 1.0 },
  ],
};
