// Replicate rate card.
// Replicate generally bills per-second on hardware, plus per-token on hosted
// language models. For text models we record token usage; for image / video
// we map predict_time × hardware rate into `costUsdCents` and surface it as
// "tokens=0, cost=X" so the receipt is still meaningful.

import type { PricingTable } from "./index";

export const replicatePricing: PricingTable = {
  "meta/llama-3.1-405b-instruct": [
    { inputPerMtok: 9.5, outputPerMtok: 9.5 },
  ],
  "meta/llama-3.1-70b-instruct": [
    { inputPerMtok: 0.65, outputPerMtok: 2.75 },
  ],
  "meta/llama-3.1-8b-instruct": [
    { inputPerMtok: 0.05, outputPerMtok: 0.25 },
  ],
};
