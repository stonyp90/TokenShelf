// Replicate sync adapter.
//
// Endpoint: GET https://api.replicate.com/v1/predictions
//   Headers: Authorization: Token <REPLICATE_API_TOKEN>
//   Cursor-paginated via the `next` URL in the response.
//
// We pull every prediction created in [since, until). Replicate returns
// `metrics.input_token_count` and `metrics.output_token_count` on text
// models, plus `metrics.predict_time` (seconds). For non-text models we
// record (input=0, output=0) but include `predict_time` in raw so the cost
// computation upstream can still attribute spend.

import type { ProviderSyncAdapter, UnifiedReceipt } from "./types";
import { AdapterError } from "./types";
import { cost } from "@/lib/pricing";

const REPLICATE_BASE = process.env.REPLICATE_API_BASE ?? "https://api.replicate.com";

type Prediction = {
  id: string;
  version: string;
  model?: string; // newer API returns model
  created_at: string;
  started_at?: string;
  completed_at?: string;
  status: string;
  metrics?: {
    predict_time?: number;
    input_token_count?: number;
    output_token_count?: number;
  };
  // Replicate doesn't return cost per prediction directly; we compute via
  // the pricing table from model + token counts when we know the model.
};

async function fetchPage(
  secret: string,
  nextUrl: string | null,
  since: Date,
): Promise<{ items: Prediction[]; next: string | null }> {
  const url = nextUrl ?? `${REPLICATE_BASE}/v1/predictions`;
  const res = await fetch(url, {
    headers: { Authorization: `Token ${secret}`, accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AdapterError(`replicate: ${res.status}`, res.status, body);
  }
  const j = (await res.json()) as { results: Prediction[]; next: string | null };
  // Replicate orders newest-first. Stop pagination once we see a prediction
  // older than `since`.
  const items = (j.results ?? []).filter((p) => new Date(p.created_at) >= since);
  const sawOlder = (j.results ?? []).some((p) => new Date(p.created_at) < since);
  return { items, next: sawOlder ? null : j.next };
}

export const replicateAdapter: ProviderSyncAdapter = {
  kind: "REPLICATE",

  async *pull({ secret, since, until }) {
    let next: string | null = null;
    let safety = 0;
    do {
      const page = await fetchPage(secret, next, since);
      next = page.next;
      for (const p of page.items) {
        const occurred = new Date(p.completed_at ?? p.created_at);
        if (occurred > until) continue;
        const model = p.model ?? p.version ?? "unknown";
        const inputTokens = p.metrics?.input_token_count ?? 0;
        const outputTokens = p.metrics?.output_token_count ?? 0;
        const costCents = cost({
          provider: "REPLICATE",
          model,
          inputTokens,
          outputTokens,
        });
        yield {
          source: "REPLICATE",
          model,
          inputTokens,
          outputTokens,
          costUsdCents: costCents,
          occurredAt: occurred,
          externalId: `replicate:${p.id}`,
          raw: p,
        } satisfies UnifiedReceipt;
      }
      safety++;
    } while (next && safety < 200);
  },

  async verify({ secret }) {
    const res = await fetch(`${REPLICATE_BASE}/v1/account`, {
      headers: { Authorization: `Token ${secret}` },
    });
    return { ok: res.ok, meta: { status: res.status } };
  },
};
