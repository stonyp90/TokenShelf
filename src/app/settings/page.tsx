import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto/envelope";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

async function updateProfile(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");

  const handle = String(formData.get("handle") ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  const bio = String(formData.get("bio") ?? "").trim() || null;
  const website = String(formData.get("website") ?? "").trim() || null;

  if (handle) {
    const conflict = await prisma.user.findFirst({
      where: { handle, NOT: { id: session.user.id } },
    });
    if (conflict) return;
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { handle: handle || undefined, bio, website },
  });
  revalidatePath("/settings");
}

async function addProviderKey(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  const kind = String(formData.get("kind") ?? "OTHER") as
    | "ANTHROPIC"
    | "OPENAI"
    | "GITHUB"
    | "GOOGLE"
    | "AZURE_OPENAI"
    | "REPLICATE"
    | "OTHER";
  const label = String(formData.get("label") ?? "").trim().toLowerCase() || "default";
  const secret = String(formData.get("secret") ?? "").trim();
  if (!secret) return;
  // Envelope-encrypt before persisting. The plaintext never touches the DB.
  const cipher = encryptSecret(secret);
  await prisma.providerConnection.upsert({
    where: { userId_kind_label: { userId: session.user.id, kind, label } },
    create: { userId: session.user.id, kind, label, secretCipher: cipher as object },
    update: { secretCipher: cipher as object },
  });
  await audit({
    userId: session.user.id,
    action: "provider.connect",
    target: `${kind}:${label}`,
    meta: { kind, label },
    success: true,
  });
  revalidatePath("/settings");
}

async function deleteProvider(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  const id = String(formData.get("id") ?? "");
  await prisma.providerConnection.deleteMany({
    where: { id, userId: session.user.id },
  });
  await audit({
    userId: session.user.id,
    action: "provider.disconnect",
    target: id,
    success: true,
  });
  revalidatePath("/settings");
}

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-border/70 bg-surface p-8 text-center">
        <p className="text-muted">Sign in to manage settings.</p>
      </div>
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      providerConnections: { orderBy: { createdAt: "asc" } },
      _count: { select: { personalAccessTokens: { where: { revokedAt: null } } } },
    },
  });
  if (!user) redirect("/");

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <form action={updateProfile} className="space-y-3">
          <Field label="Handle" name="handle" defaultValue={user.handle ?? ""} />
          <Field label="Website" name="website" defaultValue={user.website ?? ""} />
          <label className="block space-y-1">
            <span className="text-sm text-muted">Bio</span>
            <textarea
              name="bio"
              rows={3}
              defaultValue={user.bio ?? ""}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-brand px-3 py-1.5 font-medium text-black hover:bg-brand/90"
          >
            Save
          </button>
        </form>
      </section>

      <section className="space-y-4">
        <header className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Connected providers</h2>
          <p className="text-sm text-muted">
            Admin API keys are envelope-encrypted at rest. The cron at{" "}
            <code className="rounded bg-surface2 px-1 py-0.5">/api/cron/sync-all</code> uses them
            to pull verified token receipts onto your projects.
          </p>
        </header>

        <ul className="space-y-2">
          {user.providerConnections.length === 0 ? (
            <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
              No providers connected.
            </li>
          ) : null}
          {user.providerConnections.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-md border border-border/70 bg-surface px-3 py-2"
            >
              <div>
                <div className="font-mono text-sm">{c.kind.toLowerCase()}</div>
                <div className="text-xs text-muted">
                  {c.label}
                  {c.lastSyncedAt ? (
                    <span className="ml-2">
                      · last synced {c.lastSyncedAt.toISOString().slice(0, 16).replace("T", " ")}
                    </span>
                  ) : (
                    <span className="ml-2 text-token">· never synced</span>
                  )}
                </div>
              </div>
              <form action={deleteProvider}>
                <input type="hidden" name="id" value={c.id} />
                <button
                  type="submit"
                  className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-text"
                >
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>

        <form
          action={addProviderKey}
          className="space-y-3 rounded-xl border border-border/70 bg-surface p-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-sm text-muted">Provider</span>
              <select
                name="kind"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none"
                defaultValue="ANTHROPIC"
              >
                <option value="ANTHROPIC">Anthropic</option>
                <option value="OPENAI">OpenAI</option>
                <option value="GITHUB">GitHub</option>
                <option value="GOOGLE">Google</option>
                <option value="AZURE_OPENAI">Azure OpenAI</option>
                <option value="REPLICATE">Replicate</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <Field label="Label" name="label" placeholder="Personal" />
          </div>
          <label className="block space-y-1">
            <span className="text-sm text-muted">API key / token</span>
            <input
              type="password"
              name="secret"
              required
              className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm focus:border-brand focus:outline-none"
              placeholder="sk-ant-admin-…"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-brand px-3 py-1.5 font-medium text-black hover:bg-brand/90"
          >
            Connect
          </button>
        </form>
      </section>

      <section className="space-y-3 rounded-xl border border-border/70 bg-surface p-4">
        <h2 className="text-xl font-semibold tracking-tight">Personal access tokens</h2>
        <p className="text-sm text-muted">
          {user._count.personalAccessTokens > 0
            ? `You have ${user._count.personalAccessTokens} active token${user._count.personalAccessTokens === 1 ? "" : "s"}.`
            : "No active tokens."}{" "}
          Use these to post receipts from CI or the SDK without a session cookie.
        </p>
        <Link
          href="/settings/tokens"
          className="inline-block rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface2"
        >
          Manage tokens →
        </Link>
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-muted">{label}</span>
      <input
        type="text"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none"
      />
    </label>
  );
}
