import Link from "next/link";
import { formatTokens, formatUsd, outputPerDollar } from "@/lib/format";

export type ProjectCardData = {
  slug: string;
  title: string;
  tagline: string | null;
  coverUrl: string | null;
  tags: string[];
  totalInputTokens: bigint;
  totalOutputTokens: bigint;
  totalCostUsdCents: number;
  receiptCount: number;
  owner: { handle: string | null; image: string | null; name: string | null };
};

export function ProjectCard({ p }: { p: ProjectCardData }) {
  const totalTokens = p.totalInputTokens + p.totalOutputTokens;
  const handle = p.owner.handle ?? "unknown";
  return (
    <Link
      href={`/u/${handle}/${p.slug}`}
      className="group block overflow-hidden rounded-xl border border-border/70 bg-surface transition hover:border-brand/60 hover:shadow-[0_0_0_1px_hsl(142_71%_50%/.35)]"
    >
      <div className="relative aspect-[16/9] w-full bg-gradient-to-br from-surface2 via-surface to-bg">
        {p.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.coverUrl}
            alt=""
            className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">
            <span className="font-mono text-xs">no cover</span>
          </div>
        )}
        <div className="absolute right-2 top-2 rounded-md border border-token/40 bg-bg/70 px-2 py-1 font-mono text-xs text-token backdrop-blur">
          {formatTokens(totalTokens)} tok · {formatUsd(p.totalCostUsdCents)}
        </div>
      </div>
      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-1 font-semibold tracking-tight">{p.title}</h3>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted">
            {p.receiptCount} receipt{p.receiptCount === 1 ? "" : "s"}
          </span>
        </div>
        {p.tagline ? <p className="line-clamp-2 text-sm text-muted">{p.tagline}</p> : null}
        <div className="flex items-center justify-between pt-1 text-xs text-muted">
          <span>@{handle}</span>
          <span className="font-mono text-token/90">
            {outputPerDollar(p.totalOutputTokens, p.totalCostUsdCents)}
          </span>
        </div>
        {p.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {p.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted"
              >
                {t}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
