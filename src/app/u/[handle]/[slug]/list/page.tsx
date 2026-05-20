import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { formatUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

const KINDS = ["TEMPLATE", "AGENT", "PROMPT_PACK", "EVAL_SUITE", "SERVICE"] as const;
const LICENSES = [
  "MIT",
  "APACHE_2_0",
  "GPL_3_0",
  "COMMERCIAL_SINGLE",
  "COMMERCIAL_TEAM",
  "PROPRIETARY",
] as const;

async function saveListing(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");

  const projectId = String(formData.get("projectId") ?? "");
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId: session.user.id },
  });
  if (!project) redirect("/");

  const kind = String(formData.get("kind") ?? "TEMPLATE") as (typeof KINDS)[number];
  const license = String(formData.get("license") ?? "COMMERCIAL_SINGLE") as (typeof LICENSES)[number];
  const priceUsd = Number(formData.get("priceUsd") ?? "0");
  const priceUsdCents = Math.max(0, Math.round(priceUsd * 100));
  const blurb = String(formData.get("blurb") ?? "").trim() || null;
  const active = formData.get("active") === "on";

  await prisma.listing.upsert({
    where: { projectId: project.id },
    create: { projectId: project.id, kind, license, priceUsdCents, blurb, active },
    update: { kind, license, priceUsdCents, blurb, active },
  });
  await audit({
    userId: session.user.id,
    action: "listing.upsert",
    target: project.id,
    meta: { kind, priceUsdCents, license, active },
    success: true,
  });
  const owner = await prisma.user.findUnique({ where: { id: session.user.id } });
  revalidatePath(`/u/${owner?.handle ?? ""}/${project.slug}`);
  redirect(`/u/${owner?.handle ?? ""}/${project.slug}`);
}

async function unlist(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  const projectId = String(formData.get("projectId") ?? "");
  await prisma.listing.deleteMany({
    where: { projectId, project: { ownerId: session.user.id } },
  });
  await audit({
    userId: session.user.id,
    action: "listing.delete",
    target: projectId,
    success: true,
  });
  const owner = await prisma.user.findUnique({ where: { id: session.user.id } });
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  redirect(`/u/${owner?.handle ?? ""}/${project?.slug ?? ""}`);
}

export default async function ListPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-border/70 bg-surface p-8 text-center">
        <p className="text-muted">Sign in to manage listings.</p>
      </div>
    );
  }
  const { handle, slug } = await params;
  const owner = await prisma.user.findUnique({ where: { handle } });
  if (!owner || owner.id !== session.user.id) notFound();
  const project = await prisma.project.findUnique({
    where: { ownerId_slug: { ownerId: owner.id, slug } },
    include: { listing: true },
  });
  if (!project) notFound();

  const listing = project.listing;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <Link href={`/u/${handle}/${slug}`} className="text-sm text-muted hover:text-text">
          ← {project.title}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {listing ? "Edit listing" : "List for sale"}
        </h1>
        <p className="text-sm text-muted">
          Listings show up on the public marketplace with this project's token-spend receipt
          attached as the credibility signal.
        </p>
      </header>

      <form action={saveListing} className="space-y-4 rounded-xl border border-border/70 bg-surface p-4">
        <input type="hidden" name="projectId" value={project.id} />

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm text-muted">Kind</span>
            <select
              name="kind"
              defaultValue={listing?.kind ?? "TEMPLATE"}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replaceAll("_", " ").toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-muted">License</span>
            <select
              name="license"
              defaultValue={listing?.license ?? "COMMERCIAL_SINGLE"}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none"
            >
              {LICENSES.map((l) => (
                <option key={l} value={l}>
                  {l.replaceAll("_", " ").toLowerCase()}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-sm text-muted">Price (USD)</span>
          <input
            type="number"
            name="priceUsd"
            min={0}
            step="0.01"
            defaultValue={listing ? (listing.priceUsdCents / 100).toFixed(2) : "0.00"}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm focus:border-brand focus:outline-none"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-muted">Buyer blurb (markdown ok)</span>
          <textarea
            name="blurb"
            rows={6}
            defaultValue={listing?.blurb ?? ""}
            placeholder="What is being sold, how it gets delivered, who it's for…"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm focus:border-brand focus:outline-none"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="active"
            defaultChecked={listing?.active ?? true}
            className="h-4 w-4 accent-brand"
          />
          <span>Active — show on /marketplace</span>
        </label>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-brand px-3 py-1.5 font-medium text-black hover:bg-brand/90"
          >
            Save listing
          </button>
          {listing ? (
            <span className="text-xs text-muted">
              Currently {listing.active ? "live" : "hidden"} at{" "}
              {formatUsd(listing.priceUsdCents)}.
            </span>
          ) : null}
        </div>
      </form>

      {listing ? (
        <form action={unlist}>
          <input type="hidden" name="projectId" value={project.id} />
          <button
            type="submit"
            className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-text"
          >
            Delete listing
          </button>
        </form>
      ) : null}
    </div>
  );
}
