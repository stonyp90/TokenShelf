import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ProjectCard } from "@/components/project-card";
import { formatTokens, formatUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const user = await prisma.user.findUnique({
    where: { handle },
    include: {
      projects: {
        where: { published: true },
        orderBy: { createdAt: "desc" },
        include: { owner: { select: { handle: true, image: true, name: true } } },
      },
    },
  });
  if (!user) notFound();

  const totals = user.projects.reduce(
    (acc, p) => {
      acc.tokens += Number(p.totalInputTokens) + Number(p.totalOutputTokens);
      acc.cents += p.totalCostUsdCents;
      return acc;
    },
    { tokens: 0, cents: 0 },
  );

  return (
    <div className="space-y-10">
      <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" className="h-20 w-20 rounded-full border border-border" />
        ) : (
          <div className="h-20 w-20 rounded-full bg-surface2" />
        )}
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{user.name ?? `@${user.handle}`}</h1>
          <p className="text-muted">@{user.handle}</p>
          {user.bio ? <p className="max-w-prose text-sm text-muted">{user.bio}</p> : null}
        </div>
        <div className="ml-auto flex gap-6 font-mono text-sm">
          <Stat label="projects" value={user.projects.length.toString()} />
          <Stat label="total tokens" value={formatTokens(totals.tokens)} />
          <Stat label="total spend" value={formatUsd(totals.cents)} />
        </div>
      </header>
      {user.projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted">
          No projects yet.
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {user.projects.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-lg text-text">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}
