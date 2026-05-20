// Anthropic Admin API sync adapter.
//
// Endpoint: GET https://api.anthropic.com/v1/organizations/usage_report/messages
// Auth: `x-api-key: <admin key starting with sk-ant-admin-…>`
// Query: starting_at, ending_at (ISO-8601), bucket_width=1h, optional group_by
//
// Response shape (per provider docs; trimmed):
//   {
//     "data": [
//       {
//         "starting_at": "2026-05-19T00:00:00Z",
//         "ending_at":   "2026-05-19T01:00:00Z",
//         "results": [
//           {
//             "model": "claude-opus-4-7",
//             "service_tier": "standard",
//             "input_tokens": 12345,
//             "output_tokens": 678,
//             "cache_creation_input_tokens": 0,
//             "cache_read_input_tokens": 90,
//             "uncached_input_tokens": 12255,
//             "api_key_id": "apikey_…",
//             "workspace_id": null
//           }
//         ]
//       }
//     ],
//     "has_more": false,
//     "next_page": null
//   }
//
// We synthesize a stable externalId from the bucket boundaries + model +
// api_key_id so re-running the sync is idempotent.

import type { ProviderSyncAdapter, UnifiedReceipt } from "./types";
import { AdapterError } from "./types";
import { cost } from "@/lib/pricing";

const ANTHROPIC_BASE = process.env.ANTHROPIC_API_BASE ?? "https://api.anthropic.com";

type Bucket = {
  starting_at: string;
  ending_at: string;
  results: Array<{
    model: string;
    service_tier?: string;
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    uncached_input_tokens?: number;
    api_key_id?: string;
    workspace_id?: string | null;
  }>;
};

async function fetchPage(
  secret: string,
  since: Date,
  until: Date,
  pageToken: string | null,
): Promise<{ data: Bucket[]; next: string | null }> {
  const url = new URL(`${ANTHROPIC_BASE}/v1/organizations/usage_report/messages`);
  url.searchParams.set("starting_at", since.toISOString());
  url.searchParams.set("ending_at", until.toISOString());
  url.searchParams.set("bucket_width", "1h");
  url.searchParams.set("limit", "100");
  if (pageToken) url.searchParams.set("page", pageToken);

  const res = await fetch(url, {
    headers: {
      "x-api-key": secret,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AdapterError(`anthropic usage: ${res.status}`, res.status, body);
  }
  const json = (await res.json()) as { data: Bucket[]; has_more?: boolean; next_page?: string | null };
  return { data: json.data ?? [], next: json.has_more ? json.next_page ?? null : null };
}

export const anthropicAdapter: ProviderSyncAdapter = {
  kind: "ANTHROPIC",

  async *pull({ secret, since, until }) {
    let next: string | null = null;
    let safety = 0;
    do {
      const { data, next: cursor } = await fetchPage(secret, since, until, next);
      next = cursor;
      for (const bucket of data) {
        const occurredAt = new Date(bucket.starting_at);
        for (const r of bucket.results) {
          if (
            !r.input_tokens &&
            !r.output_tokens &&
            !r.cache_creation_input_tokens &&
            !r.cache_read_input_tokens
          ) {
            continue;
          }
          const inputTokens =
            (r.uncached_input_tokens ?? r.input_tokens) -
            // input_tokens already reflects cache misses on newer admin APIs;
            // prefer uncached_input_tokens when present.
            0;
          const cacheReadTokens = r.cache_read_input_tokens ?? 0;
          const cacheWriteTokens = r.cache_creation_input_tokens ?? 0;
          const outputTokens = r.output_tokens ?? 0;
          const costCents = cost({
            provider: "ANTHROPIC",
            model: r.model,
            serviceTier: r.service_tier ?? null,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
          });
          const externalId =
            `anthropic:${bucket.starting_at}:${r.model}:${r.service_tier ?? "standard"}:${r.api_key_id ?? "any"}:${r.workspace_id ?? "any"}`;
          const receipt: UnifiedReceipt = {
            source: "ANTHROPIC",
            model: r.model,
            serviceTier: r.service_tier ?? null,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            costUsdCents: costCents,
            occurredAt,
            externalId,
            raw: { bucket: { starting_at: bucket.starting_at, ending_at: bucket.ending_at }, result: r },
          };
          yield receipt;
        }
      }
      safety++;
    } while (next && safety < 200);
  },
};
