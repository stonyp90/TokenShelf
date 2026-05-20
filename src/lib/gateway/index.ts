// Gateway helpers.
//
// The gateway sits at /api/gw/<provider>/<rest...> and proxies requests to the
// upstream provider while observing usage. The engineer points their SDK at
// the gateway base URL and authenticates with a TokenShelf PAT; the gateway
// injects the user's stored provider key transparently.
//
//   ┌──────────┐   PAT   ┌────────────┐   real key   ┌─────────────┐
//   │  caller  │ ──────▶ │  gateway   │ ───────────▶ │  Anthropic  │
//   └──────────┘         │  (this app)│ ◀─────────── └─────────────┘
//                        └─────┬──────┘   response + usage
//                              │ write PROXIED TokenReceipt

import type { ProviderKind } from "@prisma/client";

export type GatewayProvider = "anthropic" | "openai";

export const GATEWAY_TARGETS: Record<GatewayProvider, { base: string; kind: ProviderKind }> = {
  anthropic: { base: process.env.ANTHROPIC_API_BASE ?? "https://api.anthropic.com", kind: "ANTHROPIC" },
  openai: { base: process.env.OPENAI_API_BASE ?? "https://api.openai.com", kind: "OPENAI" },
};

/** A normalised view of usage extracted from a provider response body. */
export type UsageRead = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  serviceTier?: string;
  externalId?: string;
};

export function parseAnthropicResponse(body: unknown): UsageRead | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const usage = (b.usage ?? {}) as Record<string, number | undefined>;
  if (!usage) return null;
  if (!usage.input_tokens && !usage.output_tokens && !usage.cache_read_input_tokens) return null;
  return {
    model: typeof b.model === "string" ? b.model : "unknown",
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    externalId: typeof b.id === "string" ? b.id : undefined,
  };
}

export function parseOpenAIResponse(body: unknown): UsageRead | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const usage = (b.usage ?? {}) as Record<string, number | undefined>;
  if (!usage || (!usage.prompt_tokens && !usage.completion_tokens)) return null;
  const cached =
    typeof (usage as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details === "object"
      ? (usage as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details?.cached_tokens ?? 0
      : 0;
  return {
    model: typeof b.model === "string" ? b.model : "unknown",
    inputTokens: (usage.prompt_tokens ?? 0) - cached,
    outputTokens: usage.completion_tokens ?? 0,
    cacheReadTokens: cached,
    externalId: typeof b.id === "string" ? b.id : undefined,
  };
}

/**
 * Best-effort streaming usage parser. SSE chunks from Anthropic include a
 * "message_delta" event whose `usage` carries the running output token count,
 * and a "message_stop" with the final usage block. OpenAI emits a final chunk
 * with `usage` when `stream_options.include_usage=true`.
 *
 * Returns the latest UsageRead seen, or null.
 */
export function parseStreamingChunk(
  provider: GatewayProvider,
  chunk: string,
  model: string,
): UsageRead | null {
  // Anthropic & OpenAI both use "data: { ... }\n\n" SSE framing.
  let latest: UsageRead | null = null;
  for (const line of chunk.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const json = line.slice(5).trim();
    if (json === "[DONE]" || !json) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      continue;
    }
    if (provider === "anthropic") {
      const obj = parsed as { type?: string; usage?: Record<string, number>; message?: { id?: string } };
      if (obj.usage) {
        // The final message in an Anthropic stream carries the complete usage
        // tally; earlier `message_delta` events carry partial totals. We just
        // take the most recent one — the SSE order guarantees the final is
        // last.
        latest = {
          model,
          inputTokens: obj.usage.input_tokens ?? 0,
          outputTokens: obj.usage.output_tokens ?? 0,
          cacheReadTokens: obj.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: obj.usage.cache_creation_input_tokens ?? 0,
          externalId: obj.message?.id,
        };
      }
    } else {
      const obj = parsed as { id?: string; model?: string; usage?: Record<string, number> };
      if (obj.usage) {
        latest = {
          model: obj.model ?? model,
          inputTokens: obj.usage.prompt_tokens ?? 0,
          outputTokens: obj.usage.completion_tokens ?? 0,
          externalId: obj.id,
        };
      }
    }
  }
  return latest;
}
