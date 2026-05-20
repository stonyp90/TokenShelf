import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth, signIn } from "@/auth";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { formatTokens, formatUsd, outputPerDollar } from "@/lib/format";

export const dynamic = "force-dynamic";

async function startCheckout(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) {
    await signIn("github", { redirectTo: `/u/${formData.get("handle")}/${formData.get("slug")}/buy` });
    return;
  }
  const listingId = String(formData.get("listingId") ?? "");
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { project: { include: { owner: { select: { handle: true } } } } },
  });
  if (!listing || !listing.active) return;
  // Stripe stub: create an Order in PENDING, then redirect to the stubbed
  // "complete" page. Real implementation: create a Stripe Checkout Session
  // here and return its url.
  const order = await prisma.order.create({
    data: {
      listingId: listing.id,
      buyerId: session.user.id,
      priceUsdCents: listing.priceUsdCents,
      status: "PENDING",
    },
  });
  await audit({
    userId: session.user.id,
    action: "order.create",
    target: order.id,
    meta: { listingId, price: listing.priceUsdCents },
    success: true,
  });
  redirect(`/orders/${order.id}`);
}

export default async function BuyPage({
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
      listing: true,
      owner: { select: { handle: true, name: true } },
    },
  });
  if (!project || !project.listing || !project.listing.active) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-1">
        <Link href={`/u/${handle}/${slug}`} className="text-sm text-muted hover:text-text">
          ← {project.title}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Buy {project.title}</h1>
        <p className="text-sm text-muted">
          Sold by <span className="text-text">@{project.owner.handle}</span> ·{" "}
          {project.listing.kind.replaceAll("_", " ").toLowerCase()} ·{" "}
          {project.listing.license.replaceAll("_", " ").toLowerCase()}.
        </p>
      </header>

      <section className="rounded-xl border border-border/70 bg-surface p-4 text-sm">
        <div className="mb-3 grid grid-cols-3 gap-3 font-mono text-xs">
          <Stat
            label="output / $"
            value={outputPerDollar(project.totalOutputTokens, project.totalCostUsdCents)}
          />
          <Stat label="total spend" value={formatUsd(project.totalCostUsdCents)} />
          <Stat label="output tokens" value={formatTokens(project.totalOutputTokens)} />
        </div>
        {project.listing.blurb ? (
          <p className="whitespace-pre-wrap text-text">{project.listing.blurb}</p>
        ) : null}
      </section>

      <form action={startCheckout} className="space-y-3 rounded-xl border border-brand/60 bg-surface p-4">
        <input type="hidden" name="listingId" value={project.listing.id} />
        <input type="hidden" name="handle" value={handle} />
        <input type="hidden" name="slug" value={slug} />
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted">Total</span>
          <span className="font-mono text-2xl text-brand">{formatUsd(project.listing.priceUsdCents)}</span>
        </div>
        <button
          type="submit"
          className="w-full rounded-md bg-brand px-3 py-2 font-medium text-black hover:bg-brand/90"
        >
          Checkout (Stripe stub)
        </button>
        <p className="text-xs text-muted">
          Stripe isn't wired yet — clicking creates a PENDING Order you can complete in /orders.
        </p>
      </form>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-token">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}
