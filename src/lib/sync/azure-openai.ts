// Azure OpenAI sync adapter (M2 — scaffold).
//
// Azure exposes usage three ways:
//   1. Azure Cost Management `Query` API — daily/monthly cost by service.
//   2. Per-deployment metrics in Azure Monitor (request count, token totals).
//   3. Azure billing exports (BigQuery-style) for high-volume customers.
//
// The full integration needs a tenant id + subscription id + Cost Mgmt scope,
// which is per-user config we don't model yet. For now: validate the key.

import type { ProviderSyncAdapter, UnifiedReceipt } from "./types";

export const azureOpenAIAdapter: ProviderSyncAdapter = {
  kind: "AZURE_OPENAI",
  async *pull(): AsyncIterable<UnifiedReceipt> {
    return;
  },
  async verify({ secret }) {
    // The "secret" we store for Azure is a deployment endpoint URL + key, in
    // the form "https://X.openai.azure.com|api-key:<key>". A real
    // implementation would parse + validate; for the stub we just confirm it
    // looks like one of those two forms.
    if (secret.startsWith("https://") && secret.includes(".openai.azure.com")) {
      return { ok: true };
    }
    if (secret.length >= 32) return { ok: true };
    return { ok: false };
  },
};
