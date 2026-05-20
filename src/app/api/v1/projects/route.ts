// Public v1 API.
//
// GET /api/v1/projects?tag=rag&limit=24&cursor=<cuid>
//
// Returns a paginated list of published projects with aggregates. No auth
// required — this is the "outside-tools-can-build-on-us" surface.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tag = url.searchParams.get("tag")?.toLowerCase() ?? undefined;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "24"), 1), 100);
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const rows = await prisma.project.findMany({
    where: { published: true, tags: tag ? { has: tag } : undefined },
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
    orderBy: [{ verifiedReceiptCount: "desc" }, { createdAt: "desc" }],
    include: {
      owner: { select: { handle: true, name: true } },
      listing: { select: { kind: true, priceUsdCents: true, license: true, active: true } },
    },
  });

  const nextCursor = rows.length > limit ? rows[limit].id : null;
  const items = rows.slice(0, limit).map((p) => ({
    handle: p.owner.handle,
    slug: p.slug,
    title: p.title,
    tagline: p.tagline,
    tags: p.tags,
    repoUrl: p.repoUrl,
    demoUrl: p.demoUrl,
    receiptCount: p.receiptCount,
    verifiedReceiptCount: p.verifiedReceiptCount,
    totalInputTokens: p.totalInputTokens.toString(),
    totalOutputTokens: p.totalOutputTokens.toString(),
    totalCacheReadTokens: p.totalCacheReadTokens.toString(),
    totalCacheWriteTokens: p.totalCacheWriteTokens.toString(),
    totalCostUsdCents: p.totalCostUsdCents,
    repoVerified: p.repoVerified,
    listing: p.listing && p.listing.active ? p.listing : null,
    createdAt: p.createdAt.toISOString(),
  }));

  return NextResponse.json(
    { items, nextCursor },
    { headers: { "cache-control": "public, max-age=60, s-maxage=60" } },
  );
}
