// Marketplace seed — runs idempotently. Adds listings to the demo projects
// created by prisma/seed.ts, plus a follow and a couple of favorites so the
// social counters aren't all zeros.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const ada = await prisma.user.findUnique({ where: { handle: "ada" } });
  const kai = await prisma.user.findUnique({ where: { handle: "kai" } });
  if (!ada || !kai) {
    throw new Error("Run prisma/seed.ts first (demo users missing).");
  }

  const rag = await prisma.project.findUnique({
    where: { ownerId_slug: { ownerId: ada.id, slug: "rag-eval-suite" } },
  });
  const playbook = await prisma.project.findUnique({
    where: { ownerId_slug: { ownerId: kai.id, slug: "agent-playbook" } },
  });
  const router = await prisma.project.findUnique({
    where: { ownerId_slug: { ownerId: kai.id, slug: "tool-router" } },
  });
  if (!rag || !playbook || !router) {
    throw new Error("Demo projects missing; run prisma/seed.ts first.");
  }

  const listings = [
    {
      projectId: rag.id,
      kind: "EVAL_SUITE" as const,
      priceUsdCents: 4900,
      license: "COMMERCIAL_SINGLE" as const,
      blurb:
        "1k hand-curated RAG questions with reference answers. Ships with an LLM-judge harness and the eval scripts I used to bench retrievers across 7 providers. Save 3 weeks.",
      active: true,
    },
    {
      projectId: playbook.id,
      kind: "TEMPLATE" as const,
      priceUsdCents: 7900,
      license: "COMMERCIAL_TEAM" as const,
      blurb:
        "Five drop-in support-agent templates with hard token budgets. Each comes with token-spend receipts from the customer who shipped it. Token cost shown is the real average per ticket.",
      active: true,
    },
    {
      projectId: router.id,
      kind: "AGENT" as const,
      priceUsdCents: 1900,
      license: "MIT" as const,
      blurb:
        "200-line MIT-licensed tool router. Tested against function-calling on 400 real intents — 94% match. Bring your own evals.",
      active: true,
    },
  ];

  for (const l of listings) {
    await prisma.listing.upsert({
      where: { projectId: l.projectId },
      create: l,
      update: { kind: l.kind, priceUsdCents: l.priceUsdCents, license: l.license, blurb: l.blurb, active: l.active },
    });
  }

  // Social primitives
  await prisma.follow.upsert({
    where: { followerId_followedId: { followerId: ada.id, followedId: kai.id } },
    create: { followerId: ada.id, followedId: kai.id },
    update: {},
  });
  await prisma.follow.upsert({
    where: { followerId_followedId: { followerId: kai.id, followedId: ada.id } },
    create: { followerId: kai.id, followedId: ada.id },
    update: {},
  });
  await prisma.favorite.upsert({
    where: { userId_projectId: { userId: ada.id, projectId: playbook.id } },
    create: { userId: ada.id, projectId: playbook.id },
    update: {},
  });
  await prisma.favorite.upsert({
    where: { userId_projectId: { userId: kai.id, projectId: rag.id } },
    create: { userId: kai.id, projectId: rag.id },
    update: {},
  });

  // An eval run so the Decisions tab shows the new section populated.
  await prisma.evalRun.create({
    data: {
      projectId: rag.id,
      suite: "rag-bench-1k",
      score: 0.812,
      modelUsed: "claude-sonnet-4-6",
    },
  });
  await prisma.evalRun.create({
    data: {
      projectId: rag.id,
      suite: "rag-bench-1k",
      score: 0.847,
      modelUsed: "claude-opus-4-7",
    },
  });

  console.log("Marketplace data seeded.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
