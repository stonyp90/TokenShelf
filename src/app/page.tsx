import { prisma } from "@/lib/db";
import { ProjectCard } from "@/components/project-card";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await prisma.project.findMany({
    where: { published: true },
    orderBy: { createdAt: "desc" },
    take: 24,
    include: { owner: { select: { handle: true, image: true, name: true } } },
  });

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Showcase your AI builds. <span className="text-brand">Show the receipt.</span>
        </h1>
        <p className="max-w-2xl text-muted">
          TokenShelf is a Behance for AI engineering. Every project carries a verified token-spend
          receipt — pulled directly from Anthropic, OpenAI, GitHub Models, and friends — so output
          per dollar is no longer a vibe.
        </p>
      </section>
      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted">
          No projects yet. Sign in and post the first one.
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </section>
      )}
    </div>
  );
}
