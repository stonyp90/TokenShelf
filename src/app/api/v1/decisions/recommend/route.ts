// POST /api/v1/decisions/recommend
//
// Body: {
//   provider: "ANTHROPIC" | "OPENAI" | "GOOGLE" | "AZURE_OPENAI" | "REPLICATE" | "BEDROCK",
//   model:    "claude-opus-4-7",                              // current model
//   workload: { inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens? }
// }
//
// Returns the same payload as the on-page recommender, so any external tool
// can ask "what would my workload cost on alternate models?".

import { NextResponse } from "next/server";
import { z } from "zod";
import { cost, knownModels, isSupportedProvider } from "@/lib/pricing";

export const dynamic = "force-dynamic";

const Body = z.object({
  provider: z.string(),
  model: z.string(),
  serviceTier: z.string().optional(),
  workload: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative().optional(),
    cacheWriteTokens: z.number().int().nonnegative().optional(),
  }),
  family: z.string().optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const { provider, model, serviceTier, workload, family } = parsed.data;
  if (!isSupportedProvider(provider)) {
    return NextResponse.json({ error: "unsupported_provider", provider }, { status: 400 });
  }
  const currentCost = cost({
    provider,
    model,
    serviceTier: serviceTier ?? null,
    inputTokens: workload.inputTokens,
    outputTokens: workload.outputTokens,
    cacheReadTokens: workload.cacheReadTokens,
    cacheWriteTokens: workload.cacheWriteTokens,
  });
  const candidates = knownModels(provider).filter((m) => {
    if (!family) return true;
    return m.toLowerCase().includes(family.toLowerCase());
  });
  const recommendations = candidates
    .map((candidate) => {
      const candidateCost = cost({
        provider,
        model: candidate,
        serviceTier: serviceTier ?? null,
        inputTokens: workload.inputTokens,
        outputTokens: workload.outputTokens,
        cacheReadTokens: workload.cacheReadTokens,
        cacheWriteTokens: workload.cacheWriteTokens,
      });
      return {
        model: candidate,
        estimatedCostUsdCents: candidateCost,
        deltaUsdCents: candidateCost - currentCost,
        deltaPct: currentCost > 0 ? ((candidateCost - currentCost) / currentCost) * 100 : 0,
      };
    })
    .sort((a, b) => a.estimatedCostUsdCents - b.estimatedCostUsdCents);
  return NextResponse.json({
    current: { model, estimatedCostUsdCents: currentCost },
    recommendations,
  });
}
