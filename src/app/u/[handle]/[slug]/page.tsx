import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { formatTokens, formatUsd, outputPerDollar } from "@/lib/format";
import { TrustBadge } from "@/components/trust-badge";
import { FavoriteButton } from "@/components/favorite-button";
import { cacheStats } from "@/lib/decisions/cache-gap";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle, slug } = await params;
  const owner = await prisma.user.findUnique({ where: { handle } });
  if (!owner) notFound();

  const session = await auth();
  const project = await prisma.project.findUnique({
    where: { ownerId_slug: { ownerId: owner.id, slug } },
    include: {
      owner: { select: { id: true, handle: true, image: true, name: true } },
      receipts: { orderBy: { occurredAt: "desc" }, take: 100 },
      listing: true,
      _count: { select: { favorites: true } },
    },
  });
  if (!project || !project.published) notFound();
  const isOwner = session?.user?.id === project.owner.id;

  const totalTokens = Number(project.totalInputTokens) + Number(project.totalOutputTokens);
  const cache = cacheStats(project.receipts);
  const verifiedShare =
    project.receiptCount === 0 ? 0 : (project.verifiedReceiptCount / project.receiptCount) * 100;

  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <Link href={`/u/${handle}`} className="text-sm text-muted hover:text-text">
          ← @{handle}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{project.title}</h1>
          <FavoriteButton projectId={project.id} redirectAfter={`/u/${handle}/${slug}`} />
          {project.repoVerified ? (
            <span
              className="rounded-full border border-brand/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-brand"
              title="The signed-in user has push access to the linked GitHub repo."
            >
              ✓ repo
            </span>
          ) : null}
          {project.verifiedReceiptCount > 0 ? (
            <span
              className="rounded-full border border-brand/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-brand"
              title={`${project.verifiedReceiptCount} of ${project.receiptCount} receipts are provider-verified.`}
            >
              {verifiedShare.toFixed(0)}% verified
            </span>
          ) : null}
        </div>
        {project.tagline ? <p className="text-lg text-muted">{project.tagline}</p> : null}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {project.tags.map((t) => (
            <span key={t} className="rounded-full border border-border/60 px-2 py-0.5 text-muted">
              {t}
            </span>
          ))}
        </div>
        <nav className="flex flex-wrap items-center gap-3 pt-1 text-sm">
          <span className="border-b border-brand pb-1 font-medium text-text">Overview</span>
          <Link href={`/u/${handle}/${slug}/decisions`} className="pb-1 text-muted hover:text-text">
            Decisions →
          </Link>
          {project.listing && project.listing.active ? (
            <Link
              href={`/u/${handle}/${slug}/buy`}
              className="ml-auto rounded-md bg-brand px-3 py-1.5 font-medium text-black hover:bg-brand/90"
            >
              Buy · {(project.listing.priceUsdCents / 100).toFixed(2)} USD
            </Link>
          ) : isOwner ? (
            <Link
              href={`/u/${handle}/${slug}/list`}
              className="ml-auto rounded-md border border-border px-3 py-1.5 hover:bg-surface"
            >
              {project.listing ? "Edit listing" : "List for sale"}
            </Link>
          ) : null}
        </nav>
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

      {project.totalCacheReadTokens > 0n || project.totalCacheWriteTokens > 0n ? (
        <section className="grid gap-3 sm:grid-cols-3">
          <Stat label="cache reads" value={formatTokens(project.totalCacheReadTokens)} />
          <Stat label="cache writes" value={formatTokens(project.totalCacheWriteTokens)} />
          <Stat label="cache hit ratio" value={`${(cache.hitRatio * 100).toFixed(1)}%`} />
        </section>
      ) : null}

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
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Receipts ({project.receiptCount} total · {formatTokens(totalTokens)} tokens)
          </h2>
          <div className="flex gap-2 text-xs">
            <TrustBadge tier="VERIFIED" /> <TrustBadge tier="PROXIED" /> <TrustBadge tier="SELF_REPORTED" />
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-border/70">
          <table className="w-full font-mono text-xs">
            <thead className="bg-surface2 text-left text-muted">
              <tr>
                <th className="px-3 py-2"></th>
                <th className="px-3 py-2">when</th>
                <th className="px-3 py-2">provider</th>
                <th className="px-3 py-2">model</th>
                <th className="px-3 py-2 text-right">in</th>
                <th className="px-3 py-2 text-right">out</th>
                <th className="px-3 py-2 text-right">cache</th>
                <th className="px-3 py-2 text-right">cost</th>
              </tr>
            </thead>
            <tbody>
              {project.receipts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted">
                    No receipts yet.
                  </td>
                </tr>
              ) : (
                project.receipts.map((r) => (
                  <tr key={r.id} className="border-t border-border/60">
                    <td className="px-3 py-2">
                      <TrustBadge tier={r.trustTier} compact />
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {r.occurredAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="px-3 py-2">{r.source.toLowerCase()}</td>
                    <td className="px-3 py-2">{r.model}</td>
                    <td className="px-3 py-2 text-right">{r.inputTokens.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{r.outputTokens.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-muted">
                      {r.cacheReadTokens > 0
                        ? `${formatTokens(r.cacheReadTokens)}r`
                        : ""}
                      {r.cacheWriteTokens > 0
                        ? ` ${formatTokens(r.cacheWriteTokens)}w`
                        : ""}
                      {r.cacheReadTokens === 0 && r.cacheWriteTokens === 0 ? "—" : ""}
                    </td>
                    <td className="px-3 py-2 text-right">{formatUsd(r.costUsdCents)}</td>
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
