// OpenAI rate card.
//
// Rates: USD per million tokens. Cached input is priced lower than fresh input
// (OpenAI applies the prompt-cache discount automatically on long prompts).
// Batch API: 50% off all rates.

import type { PricingTable } from "./index";

export const openaiPricing: PricingTable = {
  "gpt-4o": [
    { inputPerMtok: 2.5, outputPerMtok: 10.0, cacheReadPerMtok: 1.25 },
    { serviceTier: "batch", inputPerMtok: 1.25, outputPerMtok: 5.0, cacheReadPerMtok: 0.625 },
  ],
  "gpt-4o-mini": [
    { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.075 },
    { serviceTier: "batch", inputPerMtok: 0.075, outputPerMtok: 0.3, cacheReadPerMtok: 0.0375 },
  ],
  "o1": [{ inputPerMtok: 15.0, outputPerMtok: 60.0, cacheReadPerMtok: 7.5 }],
  "o1-mini": [{ inputPerMtok: 3.0, outputPerMtok: 12.0, cacheReadPerMtok: 1.5 }],
};
