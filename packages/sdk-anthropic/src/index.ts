// @tokenshelf/anthropic
//
// Drop-in wrapper around `@anthropic-ai/sdk`. Every successful response with a
// `usage` block is posted to your TokenShelf project's receipt endpoint.
//
// Usage:
//
//   import Anthropic from "@anthropic-ai/sdk";
//   import { wrap } from "@tokenshelf/anthropic";
//
//   const anthropic = wrap(new Anthropic(), {
//     projectSlug: "rag-eval-suite",
//     apiToken: process.env.TOKENSHELF_TOKEN!,
//     // optional:
//     // endpoint: "https://tokenshelf.dev/api/receipts",
//     // onError: (e) => console.warn("tokenshelf: ", e),
//   });
//
//   const msg = await anthropic.messages.create({ ... });
//
// The wrapper never throws on receipt-post failure — observability must not
// break your production code path.

type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

type AnthropicResponse = {
  id?: string;
  model?: string;
  usage?: AnthropicUsage;
};

export type WrapOptions = {
  projectSlug: string;
  apiToken: string;
  endpoint?: string;
  serviceTier?: string;
  /** Called with any error from the receipt post. Defaults to console.warn. */
  onError?: (err: unknown) => void;
};

const DEFAULT_ENDPOINT = "https://tokenshelf.dev/api/receipts";

async function postReceipt(opts: WrapOptions, response: AnthropicResponse) {
  if (!response?.usage) return;
  const body = {
    projectSlug: opts.projectSlug,
    source: "ANTHROPIC" as const,
    model: response.model ?? "unknown",
    serviceTier: opts.serviceTier,
    inputTokens: response.usage.input_tokens ?? 0,
    outputTokens: response.usage.output_tokens ?? 0,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    externalId: response.id,
  };
  try {
    const res = await fetch(opts.endpoint ?? DEFAULT_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.apiToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`tokenshelf receipt failed (${res.status}): ${text}`);
    }
  } catch (err) {
    (opts.onError ?? ((e) => console.warn("tokenshelf:", e)))(err);
  }
}

/**
 * Wrap an Anthropic client so every `messages.create` (and `messages.stream`)
 * also posts a receipt to TokenShelf. The original client is mutated and
 * returned — call this once at startup.
 */
export function wrap<T extends object>(client: T, opts: WrapOptions): T {
  const c = client as unknown as {
    messages?: {
      create?: (...args: unknown[]) => Promise<AnthropicResponse>;
      stream?: (...args: unknown[]) => unknown;
    };
  };

  if (c.messages?.create) {
    const orig = c.messages.create.bind(c.messages);
    c.messages.create = async (...args: unknown[]) => {
      const response = await orig(...args);
      // Fire-and-forget; never block the caller.
      void postReceipt(opts, response);
      return response;
    };
  }

  // Streaming: we attach to the `message` event when present. The SDK's stream
  // helper emits a final `message` payload that includes `usage`.
  if (c.messages?.stream) {
    const origStream = c.messages.stream.bind(c.messages);
    c.messages.stream = (...args: unknown[]) => {
      const stream = origStream(...args) as {
        on?: (evt: string, fn: (m: AnthropicResponse) => void) => void;
      };
      stream.on?.("message", (m) => void postReceipt(opts, m));
      return stream;
    };
  }

  return client;
}

export type { AnthropicResponse, AnthropicUsage };
