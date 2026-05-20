// Peer benchmark.
//
// Find the k=5 projects most similar to `target` by tag overlap, then summarise
// where the target sits on cost / output-per-dollar.

import { prisma } from "@/lib/db";

export type PeerBenchmark = {
  peers: Array<{
    handle: string;
    slug: string;
    title: string;
    totalCostUsdCents: number;
    totalOutputTokens: bigint;
    outputPerDollar: number;
  }>;
  median: { costUsdCents: number; outputPerDollar: number };
  targetOutputPerDollar: number;
  percentile: number; // 0..100, 0 = worst, 100 = best (more output/$)
};

export async function peerBenchmark(input: {
  projectId: string;
  tags: string[];
}): Promise<PeerBenchmark> {
  const candidates = await prisma.project.findMany({
    where: {
      published: true,
      NOT: { id: input.projectId },
      tags: input.tags.length > 0 ? { hasSome: input.tags } : undefined,
    },
    include: { owner: { select: { handle: true } } },
    take: 50,
  });

  // Score by tag overlap, take top 5.
  const scored = candidates
    .map((p) => {
      const overlap = p.tags.filter((t) => input.tags.includes(t)).length;
      return { p, score: overlap };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ p }) => {
      const cost = p.totalCostUsdCents;
      const out = Number(p.totalOutputTokens);
      return {
        handle: p.owner.handle ?? "unknown",
        slug: p.slug,
        title: p.title,
        totalCostUsdCents: cost,
        totalOutputTokens: p.totalOutputTokens,
        outputPerDollar: cost === 0 ? 0 : out / (cost / 100),
      };
    });

  // Target stats
  const target = await prisma.project.findUnique({ where: { id: input.projectId } });
  const targetOpd =
    target && target.totalCostUsdCents > 0
      ? Number(target.totalOutputTokens) / (target.totalCostUsdCents / 100)
      : 0;

  const opdList = [...scored.map((s) => s.outputPerDollar), targetOpd].sort((a, b) => a - b);
  const median = opdList[Math.floor(opdList.length / 2)] ?? 0;
  const medianCost =
    [...scored.map((s) => s.totalCostUsdCents)].sort((a, b) => a - b)[Math.floor(scored.length / 2)] ?? 0;
  const rank = opdList.indexOf(targetOpd);
  const percentile = opdList.length <= 1 ? 50 : Math.round((rank / (opdList.length - 1)) * 100);

  return {
    peers: scored,
    median: { costUsdCents: medianCost, outputPerDollar: median },
    targetOutputPerDollar: targetOpd,
    percentile,
  };
}
