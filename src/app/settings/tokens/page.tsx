import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { mintPat, revokePat } from "@/lib/pat";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

type MintResult = { token: string; prefix: string };

async function mintAction(formData: FormData): Promise<void> {
  "use server";
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  const name = String(formData.get("name") ?? "").trim();
  const projectSlug = String(formData.get("projectSlug") ?? "").trim();
  let projectId: string | null = null;
  if (projectSlug) {
    const p = await prisma.project.findUnique({
      where: { ownerId_slug: { ownerId: session.user.id, slug: projectSlug } },
    });
    if (p) projectId = p.id;
  }
  if (!name) return;
  const minted = await mintPat({
    userId: session.user.id,
    name,
    projectId,
    scopes: ["receipts:write"],
  });
  await audit({
    userId: session.user.id,
    action: "pat.mint",
    target: minted.id,
    meta: { name, projectId },
    success: true,
  });
  // Cookie-flash the freshly minted token so it appears once on the next render
  // and is then gone forever. Using searchParams keeps it transient — closing
  // the tab clears it.
  const url = `/settings/tokens?minted=${encodeURIComponent(minted.token)}&prefix=${encodeURIComponent(minted.prefix)}`;
  redirect(url);
}

async function revokeAction(formData: FormData): Promise<void> {
  "use server";
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  const id = String(formData.get("id") ?? "");
  await revokePat({ userId: session.user.id, tokenId: id });
  await audit({
    userId: session.user.id,
    action: "pat.revoke",
    target: id,
    success: true,
  });
  revalidatePath("/settings/tokens");
}

export default async function TokensPage({
  searchParams,
}: {
  searchParams: Promise<{ minted?: string; prefix?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-border/70 bg-surface p-8 text-center">
        <p className="text-muted">Sign in to manage tokens.</p>
      </div>
    );
  }
  const sp = await searchParams;
  const flashed: MintResult | null =
    sp.minted && sp.prefix ? { token: sp.minted, prefix: sp.prefix } : null;

  const tokens = await prisma.personalAccessToken.findMany({
    where: { userId: session.user.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    include: { project: { select: { slug: true, title: true } } },
  });
  const projects = await prisma.project.findMany({
    where: { ownerId: session.user.id },
    select: { slug: true, title: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Personal access tokens</h1>
        <Link href="/settings" className="text-sm text-muted hover:text-text">
          ← back to settings
        </Link>
      </header>

      {flashed ? (
        <div className="space-y-2 rounded-xl border border-brand/60 bg-surface p-4">
          <div className="text-sm text-brand">New token — copy it now, you won't see it again.</div>
          <code className="block break-all rounded bg-surface2 p-3 font-mono text-xs">
            {flashed.token}
          </code>
          <div className="text-xs text-muted">prefix: {flashed.prefix}</div>
        </div>
      ) : null}

      <form action={mintAction} className="space-y-3 rounded-xl border border-border/70 bg-surface p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm text-muted">Name</span>
            <input
              type="text"
              name="name"
              required
              placeholder="CI ingest"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-muted">Scope to project (optional)</span>
            <select
              name="projectSlug"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none"
              defaultValue=""
            >
              <option value="">— account-wide —</option>
              {projects.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.title} ({p.slug})
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="submit"
          className="rounded-md bg-brand px-3 py-1.5 font-medium text-black hover:bg-brand/90"
        >
          Mint token
        </button>
      </form>

      <section className="space-y-2">
        {tokens.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
            No active tokens.
          </div>
        ) : null}
        {tokens.map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between rounded-md border border-border/70 bg-surface px-3 py-2"
          >
            <div>
              <div className="font-mono text-sm">{t.name}</div>
              <div className="text-xs text-muted">
                {t.prefix}… ·{" "}
                {t.project ? `scoped to @${t.project.slug}` : "account-wide"} ·{" "}
                {t.lastUsedAt
                  ? `used ${t.lastUsedAt.toISOString().slice(0, 16).replace("T", " ")}`
                  : "never used"}
              </div>
            </div>
            <form action={revokeAction}>
              <input type="hidden" name="id" value={t.id} />
              <button
                type="submit"
                className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-text"
              >
                Revoke
              </button>
            </form>
          </div>
        ))}
      </section>
    </div>
  );
}
