// Azure OpenAI rate card.
// Mirrors OpenAI's direct rates; some Azure deployments negotiate custom
// rates. The Azure adapter (M2) will let the user override per-deployment.

import type { PricingTable } from "./index";

export const azureOpenAIPricing: PricingTable = {
  "gpt-4o": [
    { inputPerMtok: 2.5, outputPerMtok: 10.0, cacheReadPerMtok: 1.25 },
    { serviceTier: "batch", inputPerMtok: 1.25, outputPerMtok: 5.0 },
  ],
  "gpt-4o-mini": [
    { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.075 },
  ],
};
