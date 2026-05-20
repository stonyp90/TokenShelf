// Google Vertex / Gemini rate card.
// Rates in USD per million tokens for Gemini API direct (Vertex pricing
// differs slightly per region; treat this as a starting point and override
// per-receipt with the provider-reported cost when available).

import type { PricingTable } from "./index";

export const googlePricing: PricingTable = {
  "gemini-2.5-pro": [
    { inputPerMtok: 1.25, outputPerMtok: 10.0, cacheReadPerMtok: 0.31 },
    { serviceTier: "batch", inputPerMtok: 0.625, outputPerMtok: 5.0 },
  ],
  "gemini-2.5-flash": [
    { inputPerMtok: 0.3, outputPerMtok: 2.5, cacheReadPerMtok: 0.075 },
    { serviceTier: "batch", inputPerMtok: 0.15, outputPerMtok: 1.25 },
  ],
  "gemini-1.5-pro": [{ inputPerMtok: 1.25, outputPerMtok: 5.0 }],
  "gemini-1.5-flash": [{ inputPerMtok: 0.075, outputPerMtok: 0.3 }],
};
