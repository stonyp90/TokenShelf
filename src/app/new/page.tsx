import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

async function createProject(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const tagline = String(formData.get("tagline") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const repoUrl = String(formData.get("repoUrl") ?? "").trim() || null;
  const demoUrl = String(formData.get("demoUrl") ?? "").trim() || null;
  const coverUrl = String(formData.get("coverUrl") ?? "").trim() || null;
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);

  const slugBase =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "project";
  let slug = slugBase;
  let n = 0;
  while (
    await prisma.project.findUnique({
      where: { ownerId_slug: { ownerId: session.user.id, slug } },
    })
  ) {
    n += 1;
    slug = `${slugBase}-${n}`;
  }

  const created = await prisma.project.create({
    data: {
      ownerId: session.user.id,
      slug,
      title,
      tagline,
      description,
      repoUrl,
      demoUrl,
      coverUrl,
      tags,
    },
  });

  const owner = await prisma.user.findUnique({ where: { id: session.user.id } });
  redirect(`/u/${owner?.handle ?? ""}/${created.slug}`);
}

export default async function NewProjectPage() {
  const session = await auth();
  if (!session?.user) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-border/70 bg-surface p-8 text-center">
        <p className="text-muted">Sign in to post a project.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
        <p className="text-sm text-muted">
          Post a build. Add receipts after to back the spend claim.
        </p>
      </header>
      <form action={createProject} className="space-y-4">
        <Field label="Title" name="title" required placeholder="My LLM-powered thing" />
        <Field label="Tagline" name="tagline" placeholder="One sentence pitch" />
        <Field label="Cover image URL" name="coverUrl" placeholder="https://…" />
        <Field label="GitHub repo URL" name="repoUrl" placeholder="https://github.com/you/repo" />
        <Field label="Demo URL" name="demoUrl" placeholder="https://…" />
        <Field label="Tags (comma separated)" name="tags" placeholder="rag, eval, agent" />
        <label className="block space-y-1">
          <span className="text-sm text-muted">Description (markdown ok)</span>
          <textarea
            name="description"
            rows={8}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm focus:border-brand focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-brand px-4 py-2 font-medium text-black hover:bg-brand/90"
        >
          Publish
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  required,
  placeholder,
}: {
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-muted">
        {label}
        {required ? <span className="text-brand"> *</span> : null}
      </span>
      <input
        type="text"
        name={name}
        required={required}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none"
      />
    </label>
  );
}
