import Link from "next/link";
import type { License, ListingKind } from "@prisma/client";
import { formatTokens, formatUsd, outputPerDollar } from "@/lib/format";

export type ListingCardData = {
  id: string;
  kind: ListingKind;
  priceUsdCents: number;
  license: License;
  blurb: string | null;
  project: {
    slug: string;
    title: string;
    tagline: string | null;
    coverUrl: string | null;
    tags: string[];
    totalOutputTokens: bigint;
    totalCostUsdCents: number;
    verifiedReceiptCount: number;
    receiptCount: number;
    owner: { handle: string | null };
  };
};

const KIND_LABEL: Record<ListingKind, string> = {
  TEMPLATE: "template",
  AGENT: "agent",
  PROMPT_PACK: "prompts",
  EVAL_SUITE: "evals",
  SERVICE: "service",
};

export function ListingCard({ l }: { l: ListingCardData }) {
  const handle = l.project.owner.handle ?? "unknown";
  return (
    <Link
      href={`/u/${handle}/${l.project.slug}`}
      className="group block overflow-hidden rounded-xl border border-border/70 bg-surface transition hover:border-brand/60"
    >
      <div className="relative aspect-[16/9] w-full bg-gradient-to-br from-surface2 via-surface to-bg">
        {l.project.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={l.project.coverUrl}
            alt=""
            className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
          />
        ) : (
          <div className="flex h-full items-center justify-center font-mono text-xs text-muted">
            no cover
          </div>
        )}
        <div className="absolute left-2 top-2 rounded-md border border-border/60 bg-bg/70 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text backdrop-blur">
          {KIND_LABEL[l.kind]}
        </div>
        <div className="absolute right-2 top-2 rounded-md border border-brand/40 bg-bg/70 px-2 py-1 font-mono text-xs text-brand backdrop-blur">
          {formatUsd(l.priceUsdCents)}
        </div>
      </div>
      <div className="space-y-2 p-4">
        <h3 className="line-clamp-1 font-semibold tracking-tight">{l.project.title}</h3>
        {l.blurb ? (
          <p className="line-clamp-2 text-sm text-muted">{l.blurb}</p>
        ) : l.project.tagline ? (
          <p className="line-clamp-2 text-sm text-muted">{l.project.tagline}</p>
        ) : null}
        <div className="flex items-center justify-between pt-1 text-xs text-muted">
          <span>@{handle}</span>
          <span className="font-mono text-token/90">
            {outputPerDollar(l.project.totalOutputTokens, l.project.totalCostUsdCents)} ·{" "}
            {formatTokens(Number(l.project.totalOutputTokens))} out
          </span>
        </div>
        {l.project.verifiedReceiptCount > 0 ? (
          <div className="text-[10px] uppercase tracking-wider text-brand">
            {Math.round((l.project.verifiedReceiptCount / l.project.receiptCount) * 100)}% verified ·{" "}
            {l.license.replaceAll("_", " ").toLowerCase()}
          </div>
        ) : (
          <div className="text-[10px] uppercase tracking-wider text-muted">
            self-reported · {l.license.replaceAll("_", " ").toLowerCase()}
          </div>
        )}
      </div>
    </Link>
  );
}
