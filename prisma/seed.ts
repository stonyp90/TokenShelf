import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Demo users with sample projects + receipts so the home feed isn't empty
  // on first run. Safe to re-run: upserts by handle / (ownerId, slug).
  const demo = [
    {
      handle: "ada",
      name: "Ada Eval",
      bio: "Building RAG that doesn't lie. Receipts attached.",
      projects: [
        {
          slug: "rag-eval-suite",
          title: "RAG Eval Suite",
          tagline: "Bench your retriever on 1k real questions in 90 seconds.",
          description:
            "An open eval harness that scores retrievers on faithfulness + answer-correctness with an LLM judge. Built over two weeks of iteration.",
          coverUrl:
            "https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&auto=format&fit=crop",
          repoUrl: "https://github.com/example/rag-eval-suite",
          demoUrl: "https://example.dev/rag-eval-suite",
          tags: ["rag", "eval", "anthropic"],
          receipts: [
            { source: "ANTHROPIC", model: "claude-opus-4-7",   inputTokens: 412_000, outputTokens: 64_000, cacheReadTokens: 180_000, cacheWriteTokens:  20_000, costUsdCents: 2840, trustTier: "VERIFIED" },
            { source: "ANTHROPIC", model: "claude-sonnet-4-6", inputTokens: 1_200_000, outputTokens: 210_000, cacheReadTokens: 640_000, cacheWriteTokens:  80_000, costUsdCents: 1820, trustTier: "VERIFIED" },
            { source: "OPENAI",    model: "gpt-4o-mini",       inputTokens:   980_000, outputTokens:  90_000, cacheReadTokens: 120_000, cacheWriteTokens:        0, costUsdCents:  430, trustTier: "SELF_REPORTED" },
          ],
        },
      ],
    },
    {
      handle: "kai",
      name: "Kai Builds",
      bio: "Shipping agents with a budget.",
      projects: [
        {
          slug: "agent-playbook",
          title: "Agent Playbook",
          tagline: "Templates for sub-$1 customer-support agents.",
          description:
            "A collection of five customer-support agent templates with hard token budgets and graceful degradation when the budget is hit.",
          coverUrl:
            "https://images.unsplash.com/photo-1551033406-611cf9a28f67?w=1200&auto=format&fit=crop",
          repoUrl: "https://github.com/example/agent-playbook",
          tags: ["agent", "support", "budget"],
          receipts: [
            { source: "ANTHROPIC", model: "claude-haiku-4-5",  inputTokens: 3_400_000, outputTokens: 420_000, cacheReadTokens: 1_800_000, cacheWriteTokens: 200_000, costUsdCents: 1240, trustTier: "VERIFIED" },
            { source: "OPENAI",    model: "gpt-4o",             inputTokens:   220_000, outputTokens:  31_000, cacheReadTokens:    40_000, cacheWriteTokens:       0, costUsdCents:  890, trustTier: "SELF_REPORTED" },
          ],
        },
        {
          slug: "tool-router",
          title: "Tool Router",
          tagline: "A 200-line router that picks the right tool 94% of the time.",
          description:
            "Open-source classifier that routes user intents to the right tool — outperformed function-calling on our internal set by 8 points.",
          tags: ["routing", "tools"],
          receipts: [
            { source: "ANTHROPIC", model: "claude-sonnet-4-6", inputTokens: 600_000, outputTokens: 80_000, cacheReadTokens: 220_000, cacheWriteTokens: 30_000, costUsdCents: 780, trustTier: "VERIFIED" },
          ],
        },
      ],
    },
  ];

  for (const u of demo) {
    const user = await prisma.user.upsert({
      where: { handle: u.handle },
      create: { handle: u.handle, name: u.name, bio: u.bio, email: `${u.handle}@example.dev` },
      update: { name: u.name, bio: u.bio },
    });
    for (const p of u.projects) {
      const totalIn = p.receipts.reduce((s, r) => s + r.inputTokens, 0);
      const totalOut = p.receipts.reduce((s, r) => s + r.outputTokens, 0);
      const totalCacheRead = p.receipts.reduce((s, r) => s + (r.cacheReadTokens ?? 0), 0);
      const totalCacheWrite = p.receipts.reduce((s, r) => s + (r.cacheWriteTokens ?? 0), 0);
      const totalCents = p.receipts.reduce((s, r) => s + r.costUsdCents, 0);
      const verifiedCount = p.receipts.filter((r) => r.trustTier === "VERIFIED").length;
      const projectData = {
        title: p.title,
        tagline: p.tagline ?? null,
        description: p.description ?? null,
        coverUrl: p.coverUrl ?? null,
        repoUrl: p.repoUrl ?? null,
        demoUrl: p.demoUrl ?? null,
        tags: p.tags ?? [],
        totalInputTokens: BigInt(totalIn),
        totalOutputTokens: BigInt(totalOut),
        totalCacheReadTokens: BigInt(totalCacheRead),
        totalCacheWriteTokens: BigInt(totalCacheWrite),
        totalCostUsdCents: totalCents,
        receiptCount: p.receipts.length,
        verifiedReceiptCount: verifiedCount,
      };
      const project = await prisma.project.upsert({
        where: { ownerId_slug: { ownerId: user.id, slug: p.slug } },
        create: { ownerId: user.id, slug: p.slug, ...projectData },
        update: projectData,
      });
      // Replace receipts on re-seed for idempotency.
      await prisma.tokenReceipt.deleteMany({ where: { projectId: project.id } });
      let i = 0;
      for (const r of p.receipts) {
        i++;
        await prisma.tokenReceipt.create({
          data: {
            projectId: project.id,
            source: r.source as never,
            model: r.model,
            inputTokens: r.inputTokens,
            outputTokens: r.outputTokens,
            cacheReadTokens: r.cacheReadTokens ?? 0,
            cacheWriteTokens: r.cacheWriteTokens ?? 0,
            costUsdCents: r.costUsdCents,
            trustTier: r.trustTier as never,
            externalId: `seed:${user.handle}:${p.slug}:${i}`,
          },
        });
      }
    }
  }
  console.log("Seeded demo users and projects.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
