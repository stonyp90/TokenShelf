import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatTokens, formatUsd, outputPerDollar } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
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
      owner: { select: { handle: true, image: true, name: true } },
      receipts: { orderBy: { occurredAt: "desc" }, take: 50 },
    },
  });
  if (!project || !project.published) notFound();

  const totalTokens = Number(project.totalInputTokens) + Number(project.totalOutputTokens);

  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <Link href={`/u/${handle}`} className="text-sm text-muted hover:text-text">
          ← @{handle}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{project.title}</h1>
        {project.tagline ? <p className="text-lg text-muted">{project.tagline}</p> : null}
        <div className="flex flex-wrap gap-2 text-xs">
          {project.tags.map((t) => (
            <span key={t} className="rounded-full border border-border/60 px-2 py-0.5 text-muted">
              {t}
            </span>
          ))}
        </div>
      </header>

      {project.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={project.coverUrl}
          alt=""
          className="w-full rounded-xl border border-border object-cover"
        />
      ) : null}

      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="input tokens" value={formatTokens(project.totalInputTokens)} />
        <Stat label="output tokens" value={formatTokens(project.totalOutputTokens)} />
        <Stat label="USD spend" value={formatUsd(project.totalCostUsdCents)} />
        <Stat
          label="output / $"
          value={outputPerDollar(project.totalOutputTokens, project.totalCostUsdCents)}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-4 text-sm text-muted">
          {project.repoUrl ? (
            <a href={project.repoUrl} className="hover:text-text" target="_blank" rel="noreferrer">
              ↗ repo
            </a>
          ) : null}
          {project.demoUrl ? (
            <a href={project.demoUrl} className="hover:text-text" target="_blank" rel="noreferrer">
              ↗ demo
            </a>
          ) : null}
        </div>
        {project.description ? (
          <div className="prose prose-invert max-w-none whitespace-pre-wrap text-text">
            {project.description}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Receipts ({project.receiptCount} total · {formatTokens(totalTokens)} tokens)
        </h2>
        <div className="overflow-hidden rounded-xl border border-border/70">
          <table className="w-full font-mono text-xs">
            <thead className="bg-surface2 text-left text-muted">
              <tr>
                <th className="px-3 py-2">when</th>
                <th className="px-3 py-2">provider</th>
                <th className="px-3 py-2">model</th>
                <th className="px-3 py-2 text-right">in</th>
                <th className="px-3 py-2 text-right">out</th>
                <th className="px-3 py-2 text-right">cost</th>
                <th className="px-3 py-2 text-right">verified</th>
              </tr>
            </thead>
            <tbody>
              {project.receipts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted">
                    No receipts yet.
                  </td>
                </tr>
              ) : (
                project.receipts.map((r) => (
                  <tr key={r.id} className="border-t border-border/60">
                    <td className="px-3 py-2 text-muted">
                      {r.occurredAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="px-3 py-2">{r.source.toLowerCase()}</td>
                    <td className="px-3 py-2">{r.model}</td>
                    <td className="px-3 py-2 text-right">{r.inputTokens.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{r.outputTokens.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{formatUsd(r.costUsdCents)}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={r.verified ? "text-brand" : "text-muted"}>
                        {r.verified ? "✓" : "—"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </article>
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
