import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// /api/sync/[kind]?projectSlug=foo
//
// Pulls usage from the named provider for the authenticated user and writes
// TokenReceipts to the named project. The actual provider integrations are
// stubbed for now — wire them in adapter modules under src/lib/providers/.

const SUPPORTED = new Set(["anthropic", "openai", "github"]);

export async function POST(
  req: Request,
  context: { params: Promise<{ kind: string }> },
) {
  const { kind } = await context.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!SUPPORTED.has(kind)) {
    return NextResponse.json({ error: "unsupported_provider", kind }, { status: 400 });
  }

  const url = new URL(req.url);
  const projectSlug = url.searchParams.get("projectSlug");
  if (!projectSlug) {
    return NextResponse.json({ error: "missing_projectSlug" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { ownerId_slug: { ownerId: session.user.id, slug: projectSlug } },
  });
  if (!project) return NextResponse.json({ error: "project_not_found" }, { status: 404 });

  const conn = await prisma.providerConnection.findFirst({
    where: { userId: session.user.id, kind: kind.toUpperCase() as never },
  });
  if (!conn?.secret) {
    return NextResponse.json(
      { error: "no_provider_connection", hint: `Connect ${kind} in /settings` },
      { status: 412 },
    );
  }

  // TODO: wire real adapters
  //   - anthropic: GET https://api.anthropic.com/v1/organizations/usage_report/messages
  //   - openai:    GET https://api.openai.com/v1/usage?date=YYYY-MM-DD
  //   - github:    GET /user/settings/billing/usage (Copilot) or models usage
  // Returning a clear "not implemented" so callers see the shape.
  return NextResponse.json(
    {
      ok: false,
      status: "not_implemented",
      provider: kind,
      projectId: project.id,
      hint: "Provider sync adapters live in src/lib/providers/. PRs welcome.",
    },
    { status: 501 },
  );
}
