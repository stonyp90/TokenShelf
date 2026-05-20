// POST /api/evals — post an eval result for a project.
//
// Auth: same as /api/receipts (session or Bearer tks_…).
// Body: { projectSlug, suite, score, modelUsed?, details? }
//
// Used by CI to publish benchmark scores alongside token-spend receipts. The
// Decisions tab plots (cost, score) so buyers can see Pareto position.

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { resolvePat } from "@/lib/pat";
import { audit, clientIp } from "@/lib/audit";

const Body = z.object({
  projectId: z.string().optional(),
  projectSlug: z.string().optional(),
  suite: z.string().min(1),
  score: z.number().min(0).max(1),
  modelUsed: z.string().optional(),
  details: z.unknown().optional(),
  occurredAt: z.string().datetime().optional(),
});

async function resolveAuth(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer ")) {
    const pat = await resolvePat(header.slice(7).trim());
    if (pat) return { ok: true as const, userId: pat.userId, projectId: pat.projectId };
    return { ok: false as const };
  }
  const session = await auth();
  if (session?.user?.id) return { ok: true as const, userId: session.user.id, projectId: null };
  return { ok: false as const };
}

export async function POST(req: Request) {
  const authn = await resolveAuth(req);
  if (!authn.ok) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const data = parsed.data;
  let project = null as Awaited<ReturnType<typeof prisma.project.findUnique>>;
  if (authn.projectId) {
    project = await prisma.project.findUnique({ where: { id: authn.projectId } });
  } else if (data.projectId) {
    project = await prisma.project.findUnique({ where: { id: data.projectId } });
  } else if (data.projectSlug) {
    project = await prisma.project.findUnique({
      where: { ownerId_slug: { ownerId: authn.userId, slug: data.projectSlug } },
    });
  }
  if (!project) return NextResponse.json({ error: "project_not_found" }, { status: 404 });
  if (project.ownerId !== authn.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const eval_ = await prisma.evalRun.create({
    data: {
      projectId: project.id,
      suite: data.suite,
      score: data.score,
      modelUsed: data.modelUsed,
      details: data.details === undefined ? undefined : (data.details as object),
      occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
    },
  });
  await audit({
    userId: authn.userId,
    action: "eval.create",
    target: eval_.id,
    meta: { suite: data.suite, score: data.score },
    ip: clientIp(req),
    success: true,
  });
  return NextResponse.json({ ok: true, eval: eval_ }, { status: 201 });
}
