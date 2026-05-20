import type { TrustTier } from "@prisma/client";

const STYLES: Record<TrustTier, { dot: string; label: string; title: string }> = {
  VERIFIED: {
    dot: "bg-brand shadow-[0_0_8px_2px_hsl(142_71%_50%/.5)]",
    label: "verified",
    title: "Pulled directly from the provider's Admin API and signed by TokenShelf.",
  },
  PROXIED: {
    dot: "bg-token shadow-[0_0_8px_2px_hsl(36_100%_60%/.5)]",
    label: "proxied",
    title: "Observed in real time by the TokenShelf gateway.",
  },
  SELF_REPORTED: {
    dot: "bg-muted/60",
    label: "self-reported",
    title: "Posted by the project owner — no provider attestation.",
  },
};

export function TrustBadge({ tier, compact = false }: { tier: TrustTier; compact?: boolean }) {
  const s = STYLES[tier];
  if (compact) {
    return (
      <span
        title={s.title}
        className={`inline-block h-2 w-2 rounded-full ${s.dot}`}
        aria-label={s.label}
      />
    );
  }
  return (
    <span
      title={s.title}
      className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
