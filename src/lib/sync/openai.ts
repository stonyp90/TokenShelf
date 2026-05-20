// OpenAI Usage + Costs API sync adapter.
//
// Endpoints (Admin):
//   GET /v1/organization/usage/completions?start_time=<unix>&end_time=<unix>
//        &bucket_width=1h&group_by[]=model&group_by[]=batch&limit=...&page=...
//   GET /v1/organization/costs?start_time=<unix>&end_time=<unix>&bucket_width=1d
//
// Usage endpoints don't return USD; we compute cost ourselves via pricing
// tables. The /costs endpoint is then used as a reconciliation signal (M2).
//
// externalId combines bucket boundary + model + batch flag so re-runs are
// idempotent.

import type { ProviderSyncAdapter, UnifiedReceipt } from "./types";
import { AdapterError } from "./types";
import { cost } from "@/lib/pricing";

const OPENAI_BASE = process.env.OPENAI_API_BASE ?? "https://api.openai.com";

type UsageBucket = {
  start_time: number;
  end_time: number;
  results: Array<{
    object: "organization.usage.completions.result";
    input_tokens: number;
    output_tokens: number;
    input_cached_tokens?: number;
    num_model_requests: number;
    model?: string;
    batch?: boolean;
    project_id?: string;
    user_id?: string;
    api_key_id?: string;
  }>;
};

async function fetchUsagePage(
  secret: string,
  since: Date,
  until: Date,
  page: string | null,
): Promise<{ data: UsageBucket[]; next: string | null }> {
  const url = new URL(`${OPENAI_BASE}/v1/organization/usage/completions`);
  url.searchParams.set("start_time", Math.floor(since.getTime() / 1000).toString());
  url.searchParams.set("end_time", Math.floor(until.getTime() / 1000).toString());
  url.searchParams.set("bucket_width", "1h");
  url.searchParams.append("group_by", "model");
  url.searchParams.append("group_by", "batch");
  url.searchParams.set("limit", "180"); // OpenAI caps; mind their docs
  if (page) url.searchParams.set("page", page);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}`, "content-type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AdapterError(`openai usage: ${res.status}`, res.status, body);
  }
  const json = (await res.json()) as {
    data: UsageBucket[];
    has_more?: boolean;
    next_page?: string | null;
  };
  return { data: json.data ?? [], next: json.has_more ? json.next_page ?? null : null };
}

export const openaiAdapter: ProviderSyncAdapter = {
  kind: "OPENAI",

  async *pull({ secret, since, until }) {
    let next: string | null = null;
    let safety = 0;
    do {
      const { data, next: cursor } = await fetchUsagePage(secret, since, until, next);
      next = cursor;
      for (const bucket of data) {
        const occurredAt = new Date(bucket.start_time * 1000);
        for (const r of bucket.results) {
          if (!r.input_tokens && !r.output_tokens) continue;
          const model = r.model ?? "unknown";
          const serviceTier = r.batch ? "batch" : "standard";
          const cacheReadTokens = r.input_cached_tokens ?? 0;
          const freshInput = Math.max(r.input_tokens - cacheReadTokens, 0);
          const costCents = cost({
            provider: "OPENAI",
            model,
            serviceTier,
            inputTokens: freshInput,
            outputTokens: r.output_tokens,
            cacheReadTokens,
          });
          const externalId = `openai:${bucket.start_time}:${model}:${serviceTier}:${r.api_key_id ?? "any"}`;
          yield {
            source: "OPENAI",
            model,
            serviceTier,
            inputTokens: freshInput,
            outputTokens: r.output_tokens,
            cacheReadTokens,
            cacheWriteTokens: 0,
            costUsdCents: costCents,
            occurredAt,
            externalId,
            raw: { bucket: { start_time: bucket.start_time, end_time: bucket.end_time }, result: r },
          } satisfies UnifiedReceipt;
        }
      }
      safety++;
    } while (next && safety < 200);
  },
};
