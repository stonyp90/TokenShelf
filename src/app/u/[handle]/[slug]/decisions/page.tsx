import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { recommendModels } from "@/lib/decisions/recommend-model";
import { cacheStats } from "@/lib/decisions/cache-gap";
import { peerBenchmark } from "@/lib/decisions/peer-benchmark";
import { formatTokens, formatUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DecisionsPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle, slug } = await params;
  const owner = await prisma.user.findUnique({ where: { handle } });
  if (!owner) notFound();
  const project = await prisma.project.findUnique({
    where: { ownerId_slug: { ownerId: owner.id, slug } },
    include: {
      receipts: { orderBy: { occurredAt: "desc" }, take: 500 },
      evals: { orderBy: { occurredAt: "desc" }, take: 50 },
    },
  });
  if (!project || !project.published) notFound();

  const provider = pickPrimaryProvider(project.receipts);
  const recommend =
    provider === "ANTHROPIC" || provider === "OPENAI"
      ? recommendModels({ receipts: project.receipts, provider })
      : null;
  const cache = cacheStats(project.receipts);
  const peers = await peerBenchmark({ projectId: project.id, tags: project.tags });

  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <Link
          href={`/u/${handle}/${slug}`}
          className="text-sm text-muted hover:text-text"
        >
          ← {project.title}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Decisions</h1>
        <p className="text-muted">
          Receipt-driven, pure-function. No opaque ML — every number traces back to a row.
        </p>
      </header>

      {/* MODEL RECOMMENDER */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Model recommender
        </h2>
        {!recommend || recommend.recommendations.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
            Connect Anthropic or OpenAI and run a sync to populate this panel.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/70">
            <table className="w-full font-mono text-xs">
              <thead className="bg-surface2 text-left text-muted">
                <tr>
                  <th className="px-3 py-2">model</th>
                  <th className="px-3 py-2 text-right">est. cost</th>
                  <th className="px-3 py-2 text-right">vs. current</th>
                </tr>
              </thead>
              <tbody>
                {recommend.recommendations.map((r) => {
                  const isCurrent = r.model === recommend.current.primaryModel;
                  return (
                    <tr
                      key={r.model}
                      className={`border-t border-border/60 ${isCurrent ? "bg-surface2/60" : ""}`}
                    >
                      <td className="px-3 py-2">
                        {r.model}
                        {isCurrent ? <span className="ml-2 text-token">· current</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right">{formatUsd(r.estimatedCostUsdCents)}</td>
                      <td
                        className={`px-3 py-2 text-right ${
                          r.deltaUsdCents < 0 ? "text-brand" : r.deltaUsdCents > 0 ? "text-token" : "text-muted"
                        }`}
                      >
                        {r.deltaUsdCents === 0
                          ? "—"
                          : `${r.deltaUsdCents < 0 ? "−" : "+"}${formatUsd(Math.abs(r.deltaUsdCents))} (${r.deltaPct >= 0 ? "+" : ""}${r.deltaPct.toFixed(0)}%)`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* CACHE GAP */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Prompt-cache utilisation
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="hit ratio" value={`${(cache.hitRatio * 100).toFixed(1)}%`} />
          <Stat label="cache reads" value={formatTokens(cache.totalCacheRead)} />
          <Stat
            label="potential savings"
            value={cache.potentialSavingsCents > 0 ? formatUsd(cache.potentialSavingsCents) : "—"}
          />
        </div>
        {cache.recommendation ? (
          <p className="rounded-xl border border-token/40 bg-surface p-4 text-sm text-token">
            {cache.recommendation}
          </p>
        ) : null}
      </section>

      {/* EVAL RUNS */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Eval runs
        </h2>
        {project.evals.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
            No eval runs posted yet. Use <code className="rounded bg-surface2 px-1 py-0.5">POST /api/evals</code> from CI to publish benchmark scores alongside your spend.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/70">
            <table className="w-full font-mono text-xs">
              <thead className="bg-surface2 text-left text-muted">
                <tr>
                  <th className="px-3 py-2">when</th>
                  <th className="px-3 py-2">suite</th>
                  <th className="px-3 py-2">model</th>
                  <th className="px-3 py-2 text-right">score</th>
                </tr>
              </thead>
              <tbody>
                {project.evals.map((e) => (
                  <tr key={e.id} className="border-t border-border/60">
                    <td className="px-3 py-2 text-muted">
                      {e.occurredAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="px-3 py-2">{e.suite}</td>
                    <td className="px-3 py-2">{e.modelUsed ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-brand">{(e.score * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* PEER BENCHMARK */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Peer benchmark
        </h2>
        {peers.peers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
            Not enough peers with similar tags yet. Add more specific tags to surface comparisons.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              This project's output-per-dollar: <span className="font-mono text-text">
                {formatTokens(peers.targetOutputPerDollar)} tok/$
              </span>{" "}
              · percentile <span className="font-mono text-token">{peers.percentile}</span> of nearest 5 peers.
            </p>
            <div className="overflow-hidden rounded-xl border border-border/70">
              <table className="w-full font-mono text-xs">
                <thead className="bg-surface2 text-left text-muted">
                  <tr>
                    <th className="px-3 py-2">project</th>
                    <th className="px-3 py-2 text-right">spend</th>
                    <th className="px-3 py-2 text-right">tok/$</th>
                  </tr>
                </thead>
                <tbody>
                  {peers.peers.map((p) => (
                    <tr key={`${p.handle}/${p.slug}`} className="border-t border-border/60">
                      <td className="px-3 py-2">
                        <Link
                          href={`/u/${p.handle}/${p.slug}`}
                          className="hover:text-text text-muted"
                        >
                          @{p.handle}/{p.slug}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right">{formatUsd(p.totalCostUsdCents)}</td>
                      <td className="px-3 py-2 text-right">{formatTokens(p.outputPerDollar)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-surface p-4">
      <div className="font-mono text-xl text-token">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}

function pickPrimaryProvider(
  receipts: { source: string; costUsdCents: number }[],
): "ANTHROPIC" | "OPENAI" | "OTHER" {
  const tally = new Map<string, number>();
  for (const r of receipts) tally.set(r.source, (tally.get(r.source) ?? 0) + r.costUsdCents);
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return top === "ANTHROPIC" || top === "OPENAI" ? top : "OTHER";
}
