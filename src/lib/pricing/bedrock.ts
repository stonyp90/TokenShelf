// AWS Bedrock rate card.
// We mirror the underlying model-provider rates; AWS pricing per-region can
// differ slightly. Useful for cost lookups when an engineer is comparing
// "direct vs Bedrock" for the same model family.

import type { PricingTable } from "./index";

export const bedrockPricing: PricingTable = {
  "anthropic.claude-sonnet-4-6-v1:0": [
    { inputPerMtok: 3.0, outputPerMtok: 15.0, cacheReadPerMtok: 0.3, cacheWritePerMtok: 3.75 },
  ],
  "anthropic.claude-haiku-4-5-v1:0": [
    { inputPerMtok: 0.8, outputPerMtok: 4.0, cacheReadPerMtok: 0.08, cacheWritePerMtok: 1.0 },
  ],
};
