import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { syncProvider, verifyRepoAccess } from "@/lib/sync";
import { decryptSecret } from "@/lib/crypto/envelope";
import { audit, clientIp } from "@/lib/audit";
import type { Prisma, ProviderKind } from "@prisma/client";

const KIND_MAP: Record<string, ProviderKind> = {
  anthropic: "ANTHROPIC",
  openai: "OPENAI",
  github: "GITHUB",
};

export async function POST(req: Request, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const canonical = KIND_MAP[kind.toLowerCase()];
  if (!canonical) {
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
  if (!project) {
    return NextResponse.json({ error: "project_not_found" }, { status: 404 });
  }

  // GitHub isn't a token-usage source; the action is "verify repo access".
  if (canonical === "GITHUB") {
    if (!project.repoUrl) {
      return NextResponse.json({ error: "project_has_no_repoUrl" }, { status: 412 });
    }
    const conn = await prisma.providerConnection.findFirst({
      where: { userId: session.user.id, kind: "GITHUB" },
    });
    if (!conn?.secretCipher) {
      return NextResponse.json({ error: "no_provider_connection" }, { status: 412 });
    }
    const secret = decryptSecret(conn.secretCipher as Prisma.JsonObject);
    const result = await verifyRepoAccess({ secret, repoUrl: project.repoUrl });
    await prisma.project.update({
      where: { id: project.id },
      data: { repoVerified: result.ok },
    });
    await audit({
      userId: session.user.id,
      action: "sync.github.verify",
      target: project.id,
      meta: result,
      ip: clientIp(req),
      ua: req.headers.get("user-agent") ?? undefined,
      success: result.ok,
      error: result.ok ? null : result.reason ?? null,
    });
    return NextResponse.json({ ok: result.ok, verify: result }, { status: result.ok ? 200 : 422 });
  }

  const summary = await syncProvider({
    userId: session.user.id,
    projectId: project.id,
    kind: canonical,
  });
  return NextResponse.json(summary, { status: summary.ok ? 200 : 207 });
}
