import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { formatUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");

  const orders = await prisma.order.findMany({
    where: { buyerId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      listing: {
        include: {
          project: { include: { owner: { select: { handle: true } } } },
        },
      },
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Your orders</h1>
      {orders.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted">
          You haven't purchased anything yet.{" "}
          <Link href="/marketplace" className="text-text hover:underline">
            Browse the marketplace →
          </Link>
        </p>
      ) : (
        <ul className="space-y-2">
          {orders.map((o) => (
            <li
              key={o.id}
              className="flex items-center justify-between rounded-md border border-border/70 bg-surface px-3 py-2"
            >
              <div>
                <Link
                  href={`/orders/${o.id}`}
                  className="font-mono text-sm hover:text-text"
                >
                  {o.listing.project.title}
                </Link>
                <div className="text-xs text-muted">
                  @{o.listing.project.owner.handle} ·{" "}
                  {o.createdAt.toISOString().slice(0, 16).replace("T", " ")} ·{" "}
                  <StatusBadge status={o.status} />
                </div>
              </div>
              <div className="font-mono text-sm">{formatUsd(o.priceUsdCents)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: "PENDING" | "PAID" | "REFUNDED" | "FAILED" }) {
  const cls =
    status === "PAID"
      ? "text-brand"
      : status === "PENDING"
        ? "text-token"
        : status === "REFUNDED"
          ? "text-muted"
          : "text-red-400";
  return <span className={`uppercase tracking-wider ${cls}`}>{status.toLowerCase()}</span>;
}
