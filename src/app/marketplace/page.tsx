import { prisma } from "@/lib/db";
import { ListingCard } from "@/components/listing-card";

export const dynamic = "force-dynamic";

const KINDS = ["TEMPLATE", "AGENT", "PROMPT_PACK", "EVAL_SUITE", "SERVICE"] as const;

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; tag?: string }>;
}) {
  const sp = await searchParams;
  const kindFilter = KINDS.find((k) => k === sp.kind);
  const tagFilter = sp.tag?.trim().toLowerCase();

  const listings = await prisma.listing.findMany({
    where: {
      active: true,
      kind: kindFilter ?? undefined,
      project: tagFilter ? { tags: { has: tagFilter } } : undefined,
    },
    include: {
      project: {
        include: { owner: { select: { handle: true } } },
      },
    },
    orderBy: [
      { project: { verifiedReceiptCount: "desc" } },
      { createdAt: "desc" },
    ],
    take: 48,
  });

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          The receipt-backed marketplace.
        </h1>
        <p className="max-w-2xl text-muted">
          Every listing carries the token economics of the build it came from — so the price tag is
          never the only number you're buying on.
        </p>
      </header>

      <nav className="flex flex-wrap items-center gap-2 text-xs">
        <FilterLink current={sp.kind} value={undefined} label="all" />
        {KINDS.map((k) => (
          <FilterLink key={k} current={sp.kind} value={k} label={k.replaceAll("_", " ").toLowerCase()} />
        ))}
      </nav>

      {listings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted">
          No listings yet. Post a project and list it from its page.
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((l) => (
            <ListingCard key={l.id} l={l} />
          ))}
        </section>
      )}
    </div>
  );
}

function FilterLink({
  current,
  value,
  label,
}: {
  current?: string;
  value?: string;
  label: string;
}) {
  const active = current === value || (!value && !current);
  const href = value ? `/marketplace?kind=${value}` : `/marketplace`;
  return (
    <a
      href={href}
      className={`rounded-full border px-3 py-1 ${
        active
          ? "border-brand/60 bg-surface text-brand"
          : "border-border/60 text-muted hover:text-text"
      }`}
    >
      {label}
    </a>
  );
}
