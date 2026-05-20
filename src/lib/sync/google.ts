// Google AI / Vertex sync adapter.
//
// Two ways to record usage:
//   1. Gemini API direct — no first-party admin usage endpoint as of 2026-05.
//      Receipts arrive via the proxy gateway or the SDK middleware.
//   2. Vertex AI — Cloud Billing API + BigQuery billing export. The full
//      integration requires a BigQuery dataset; here we expose a stub that
//      validates the credential and returns nothing, so the orchestrator
//      treats it as "successful sync, zero new receipts".
//
// To go from stub → real: implement `pullVertex` which queries the user's
// configured BigQuery billing dataset for SKUs matching `services.skus.name`
// containing "Generative AI" and emits one UnifiedReceipt per row.

import type { ProviderSyncAdapter, UnifiedReceipt } from "./types";

export const googleAdapter: ProviderSyncAdapter = {
  kind: "GOOGLE",
  async *pull(): AsyncIterable<UnifiedReceipt> {
    // TODO: Vertex billing export integration (M2). Returns nothing today so
    // the orchestrator records a clean sync run.
    return;
  },
  async verify({ secret }) {
    // Google API key validation: hit `https://generativelanguage.googleapis.com/v1beta/models`
    // with the key — 200 = valid.
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("key", secret);
    const res = await fetch(url);
    return { ok: res.ok, meta: { status: res.status } };
  },
};
