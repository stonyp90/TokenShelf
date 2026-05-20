// GET /api/v1/projects/[handle]/[slug]
//
// Returns the full project payload — aggregates + last 200 receipts. Public.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ handle: string; slug: string }> },
) {
  const { handle, slug } = await context.params;
  const owner = await prisma.user.findUnique({ where: { handle } });
  if (!owner) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const project = await prisma.project.findUnique({
    where: { ownerId_slug: { ownerId: owner.id, slug } },
    include: {
      owner: { select: { handle: true, name: true } },
      listing: true,
      receipts: { orderBy: { occurredAt: "desc" }, take: 200 },
      evals: { orderBy: { occurredAt: "desc" }, take: 50 },
    },
  });
  if (!project || !project.published) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(
    {
      handle: project.owner.handle,
      slug: project.slug,
      title: project.title,
      tagline: project.tagline,
      description: project.description,
      tags: project.tags,
      repoUrl: project.repoUrl,
      demoUrl: project.demoUrl,
      repoVerified: project.repoVerified,
      receiptCount: project.receiptCount,
      verifiedReceiptCount: project.verifiedReceiptCount,
      totalInputTokens: project.totalInputTokens.toString(),
      totalOutputTokens: project.totalOutputTokens.toString(),
      totalCacheReadTokens: project.totalCacheReadTokens.toString(),
      totalCacheWriteTokens: project.totalCacheWriteTokens.toString(),
      totalCostUsdCents: project.totalCostUsdCents,
      listing: project.listing && project.listing.active ? project.listing : null,
      receipts: project.receipts.map((r) => ({
        id: r.id,
        source: r.source,
        model: r.model,
        serviceTier: r.serviceTier,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        cacheWriteTokens: r.cacheWriteTokens,
        costUsdCents: r.costUsdCents,
        occurredAt: r.occurredAt.toISOString(),
        externalId: r.externalId,
        trustTier: r.trustTier,
        responseHash: r.responseHash,
        signature: r.signature,
        signerKeyId: r.signerKeyId,
      })),
      evals: project.evals.map((e) => ({
        id: e.id,
        suite: e.suite,
        score: e.score,
        modelUsed: e.modelUsed,
        occurredAt: e.occurredAt.toISOString(),
      })),
    },
    { headers: { "cache-control": "public, max-age=30, s-maxage=30" } },
  );
}
