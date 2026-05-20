// Proxy gateway. Real-time per-request observation of LLM traffic.
//
// Auth:    Authorization: Bearer tks_<PAT>
// Routing: /api/gw/anthropic/v1/messages → https://api.anthropic.com/v1/messages
// Key:     the gateway looks up the user's ProviderConnection for the
//          provider, decrypts the stored API key, and forwards.
//
// Receipts: a PROXIED TokenReceipt is written on every observed response.
//           Streaming responses are tee'd; the final usage block is captured.
// Privacy:  prompts/completions are NOT stored unless the project's
//           `storePrompts=true`. We always store byte counts + model.
//
// SDK pointer:
//   const anthropic = new Anthropic({
//     baseURL: "https://tokenshelf.dev/api/gw/anthropic/v1",
//     apiKey:  process.env.TOKENSHELF_TOKEN,  // a tks_ PAT
//   });

import { NextResponse } from "next/server";
import type { Prisma, ProviderKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolvePat } from "@/lib/pat";
import { decryptSecret } from "@/lib/crypto/envelope";
import { cost as priceCost } from "@/lib/pricing";
import { audit, clientIp } from "@/lib/audit";
import {
  GATEWAY_TARGETS,
  parseAnthropicResponse,
  parseOpenAIResponse,
  parseStreamingChunk,
  type GatewayProvider,
  type UsageRead,
} from "@/lib/gateway";

export const dynamic = "force-dynamic";
// Streaming responses can be long; bump the runtime ceiling.
export const maxDuration = 300;

function isGwProvider(p: string): p is GatewayProvider {
  return p === "anthropic" || p === "openai";
}

async function authenticate(req: Request): Promise<
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      userId: string;
      projectId: string | null;
    }
> {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "missing_bearer_token" };
  }
  const tok = header.slice("Bearer ".length).trim();
  const pat = await resolvePat(tok);
  if (!pat) return { ok: false, status: 401, error: "invalid_pat" };
  if (!pat.scopes.includes("receipts:write")) {
    return { ok: false, status: 403, error: "pat_missing_scope" };
  }
  return { ok: true, userId: pat.userId, projectId: pat.projectId };
}

async function loadProviderKey(userId: string, kind: ProviderKind): Promise<string | null> {
  const conn = await prisma.providerConnection.findFirst({ where: { userId, kind } });
  if (!conn?.secretCipher) return null;
  try {
    return decryptSecret(conn.secretCipher as Prisma.JsonObject);
  } catch {
    return null;
  }
}

async function pickProject(userId: string, patProjectId: string | null) {
  if (patProjectId) {
    return prisma.project.findUnique({ where: { id: patProjectId } });
  }
  // Fall back to the user's most recently updated project.
  return prisma.project.findFirst({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
  });
}

async function writeReceipt(input: {
  projectId: string;
  userId: string;
  source: ProviderKind;
  usage: UsageRead;
  serviceTier?: string;
  rawForStorage: unknown;
  storePrompts: boolean;
}) {
  const computedCost = priceCost({
    provider: input.source === "ANTHROPIC" ? "ANTHROPIC" : "OPENAI",
    model: input.usage.model,
    serviceTier: input.serviceTier ?? null,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cacheReadTokens: input.usage.cacheReadTokens,
    cacheWriteTokens: input.usage.cacheWriteTokens,
  });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.tokenReceipt.create({
        data: {
          projectId: input.projectId,
          source: input.source,
          model: input.usage.model,
          serviceTier: input.serviceTier,
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          cacheReadTokens: input.usage.cacheReadTokens ?? 0,
          cacheWriteTokens: input.usage.cacheWriteTokens ?? 0,
          costUsdCents: computedCost,
          externalId: input.usage.externalId,
          trustTier: "PROXIED",
          // Privacy: only persist raw payload if the project opted in.
          raw: input.storePrompts ? (input.rawForStorage as object) : undefined,
        },
      });
      await tx.project.update({
        where: { id: input.projectId },
        data: {
          totalInputTokens: { increment: input.usage.inputTokens },
          totalOutputTokens: { increment: input.usage.outputTokens },
          totalCacheReadTokens: { increment: input.usage.cacheReadTokens ?? 0 },
          totalCacheWriteTokens: { increment: input.usage.cacheWriteTokens ?? 0 },
          totalCostUsdCents: { increment: computedCost },
          receiptCount: { increment: 1 },
        },
      });
    });
    await audit({
      userId: input.userId,
      action: `gateway.${input.source.toLowerCase()}.receipt`,
      target: input.projectId,
      meta: { model: input.usage.model, cost: computedCost },
      success: true,
    });
  } catch (e) {
    // Idempotency: duplicate externalId means we already wrote it (replays).
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      (e as { code: string }).code === "P2002"
    ) {
      return;
    }
    await audit({
      userId: input.userId,
      action: `gateway.${input.source.toLowerCase()}.receipt`,
      target: input.projectId,
      meta: { error: (e as Error).message },
      success: false,
      error: (e as Error).message,
    });
  }
}

type Ctx = { params: Promise<{ provider: string; path: string[] }> };

async function handle(req: Request, ctx: Ctx) {
  const { provider, path } = await ctx.params;
  if (!isGwProvider(provider)) {
    return NextResponse.json({ error: "unsupported_provider", provider }, { status: 404 });
  }
  const authn = await authenticate(req);
  if (!authn.ok) {
    return NextResponse.json({ error: authn.error }, { status: authn.status });
  }
  const target = GATEWAY_TARGETS[provider];
  const upstreamKey = await loadProviderKey(authn.userId, target.kind);
  if (!upstreamKey) {
    return NextResponse.json(
      { error: "no_provider_connection", hint: `Connect ${provider} in /settings` },
      { status: 412 },
    );
  }
  const project = await pickProject(authn.userId, authn.projectId);
  if (!project) {
    return NextResponse.json({ error: "no_project_to_attribute_to" }, { status: 412 });
  }

  // Rebuild upstream URL preserving the path + search.
  const incoming = new URL(req.url);
  const upstreamUrl = new URL(`${target.base}/${path.join("/")}`);
  for (const [k, v] of incoming.searchParams) upstreamUrl.searchParams.set(k, v);

  // Build upstream request — copy method + body, swap auth header.
  const headers = new Headers();
  for (const [k, v] of req.headers) {
    const kl = k.toLowerCase();
    if (kl === "authorization" || kl === "x-api-key" || kl === "host" || kl === "content-length") {
      continue;
    }
    headers.set(k, v);
  }
  if (provider === "anthropic") {
    headers.set("x-api-key", upstreamKey);
    if (!headers.get("anthropic-version")) headers.set("anthropic-version", "2023-06-01");
  } else {
    headers.set("authorization", `Bearer ${upstreamKey}`);
  }

  const bodyBuf =
    req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
  const requestedModel = (() => {
    try {
      if (bodyBuf) {
        const text = new TextDecoder().decode(bodyBuf);
        const j = JSON.parse(text) as { model?: string };
        return j.model;
      }
    } catch {
      return undefined;
    }
    return undefined;
  })();

  const upstreamRes = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    body: bodyBuf,
    // Stream bodies are handled below.
    redirect: "manual",
  });

  // Streaming vs non-streaming branch.
  const ct = upstreamRes.headers.get("content-type") ?? "";
  const isStreaming = ct.includes("text/event-stream") || ct.includes("application/x-ndjson");

  if (!isStreaming) {
    const raw = await upstreamRes.arrayBuffer();
    const text = new TextDecoder().decode(raw);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON — pass through with no receipt
    }
    const usage =
      provider === "anthropic" ? parseAnthropicResponse(parsed) : parseOpenAIResponse(parsed);
    if (upstreamRes.ok && usage) {
      // Fire-and-forget; don't block the client.
      void writeReceipt({
        projectId: project.id,
        userId: authn.userId,
        source: target.kind,
        usage,
        rawForStorage: parsed,
        storePrompts: project.storePrompts,
      });
    }
    return new NextResponse(raw, {
      status: upstreamRes.status,
      headers: passthroughHeaders(upstreamRes.headers),
    });
  }

  // Streaming: tee the body. Read chunks, append to a tail buffer for usage
  // parsing, and re-emit them to the caller verbatim.
  const reader = upstreamRes.body?.getReader();
  if (!reader) {
    return new NextResponse("upstream returned no body", { status: 502 });
  }
  const decoder = new TextDecoder();
  let tail = "";
  let lastUsage: UsageRead | null = null;
  const stream = new ReadableStream({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        if (lastUsage && project) {
          void writeReceipt({
            projectId: project.id,
            userId: authn.userId,
            source: target.kind,
            usage: {
              ...lastUsage,
              model: lastUsage.model || requestedModel || "unknown",
            },
            rawForStorage: { streamed: true, tail: tail.slice(-2000) },
            storePrompts: project.storePrompts,
          });
        }
        controller.close();
        return;
      }
      controller.enqueue(value);
      tail += decoder.decode(value, { stream: true });
      // Keep only the last ~16KB of SSE for parsing — the usage block is at
      // the end of the stream for both providers.
      if (tail.length > 32_000) tail = tail.slice(-16_000);
      const u = parseStreamingChunk(provider, tail, requestedModel ?? "unknown");
      if (u) lastUsage = u;
    },
    cancel() {
      reader.cancel().catch(() => undefined);
    },
  });

  return new NextResponse(stream, {
    status: upstreamRes.status,
    headers: passthroughHeaders(upstreamRes.headers),
  });
}

function passthroughHeaders(src: Headers): Headers {
  const out = new Headers();
  for (const [k, v] of src) {
    const kl = k.toLowerCase();
    if (kl === "content-encoding" || kl === "content-length" || kl === "transfer-encoding") continue;
    out.set(k, v);
  }
  out.set("x-tokenshelf-gateway", "1");
  return out;
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
