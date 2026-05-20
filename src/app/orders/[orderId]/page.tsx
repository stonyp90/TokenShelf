import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { formatUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

// Stub Stripe completion. A real implementation receives a webhook from Stripe
// after Checkout returns; we'd verify the signature, then flip the order to
// PAID and emit a delivery url.
async function completeStub(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  const id = String(formData.get("id") ?? "");
  const order = await prisma.order.findFirst({
    where: { id, buyerId: session.user.id, status: "PENDING" },
    include: { listing: { include: { project: { select: { repoUrl: true } } } } },
  });
  if (!order) return;
  // Soft delivery: for TEMPLATE listings we point at the project's repo. Real
  // products would generate a signed download URL or a private invocation token.
  const deliveryUrl =
    order.listing.kind === "TEMPLATE" || order.listing.kind === "EVAL_SUITE"
      ? order.listing.project.repoUrl ?? null
      : null;
  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: "PAID",
      paidAt: new Date(),
      paymentIntentId: `pi_stub_${order.id.slice(0, 12)}`,
      deliveryUrl,
    },
  });
  await audit({
    userId: session.user.id,
    action: "order.complete_stub",
    target: order.id,
    success: true,
  });
  revalidatePath(`/orders/${order.id}`);
}

export default async function OrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  const { orderId } = await params;
  const order = await prisma.order.findFirst({
    where: { id: orderId, buyerId: session.user.id },
    include: {
      listing: {
        include: {
          project: {
            include: { owner: { select: { handle: true } } },
          },
        },
      },
    },
  });
  if (!order) notFound();

  const handle = order.listing.project.owner.handle ?? "unknown";

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-1">
        <Link href="/orders" className="text-sm text-muted hover:text-text">
          ← orders
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Order for {order.listing.project.title}
        </h1>
        <p className="text-sm text-muted">
          @{handle} ·{" "}
          {order.listing.kind.replaceAll("_", " ").toLowerCase()} ·{" "}
          {order.listing.license.replaceAll("_", " ").toLowerCase()} ·{" "}
          <span
            className={
              order.status === "PAID" ? "text-brand" : order.status === "PENDING" ? "text-token" : "text-muted"
            }
          >
            {order.status.toLowerCase()}
          </span>
        </p>
      </header>

      <section className="rounded-xl border border-border/70 bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted">Total</span>
          <span className="font-mono text-2xl">{formatUsd(order.priceUsdCents)}</span>
        </div>
      </section>

      {order.status === "PENDING" ? (
        <form action={completeStub} className="space-y-3 rounded-xl border border-brand/40 bg-surface p-4">
          <input type="hidden" name="id" value={order.id} />
          <p className="text-sm text-muted">
            Stripe Checkout is not wired yet. Click below to simulate a successful payment so you
            can exercise the post-purchase flow.
          </p>
          <button
            type="submit"
            className="rounded-md bg-brand px-3 py-1.5 font-medium text-black hover:bg-brand/90"
          >
            Mark as paid (stub)
          </button>
        </form>
      ) : null}

      {order.status === "PAID" ? (
        <section className="space-y-2 rounded-xl border border-brand/40 bg-surface p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-brand">
            Delivery
          </h2>
          {order.deliveryUrl ? (
            <p className="text-sm">
              <a
                href={order.deliveryUrl}
                className="font-mono text-text underline"
                target="_blank"
                rel="noreferrer"
              >
                {order.deliveryUrl}
              </a>
            </p>
          ) : (
            <p className="text-sm text-muted">
              The seller will be in touch with delivery details. Order id:{" "}
              <code className="rounded bg-surface2 px-1 py-0.5 text-xs">{order.id}</code>
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
