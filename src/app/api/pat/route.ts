import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { mintPat, revokePat } from "@/lib/pat";
import { audit, clientIp } from "@/lib/audit";

const MintInput = z.object({
  name: z.string().min(1).max(60),
  projectSlug: z.string().optional(),
  scopes: z.array(z.enum(["receipts:write"])).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = MintInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }
  let projectId: string | null = null;
  if (parsed.data.projectSlug) {
    const p = await prisma.project.findUnique({
      where: { ownerId_slug: { ownerId: session.user.id, slug: parsed.data.projectSlug } },
    });
    if (!p) return NextResponse.json({ error: "project_not_found" }, { status: 404 });
    projectId = p.id;
  }
  const minted = await mintPat({
    userId: session.user.id,
    name: parsed.data.name,
    projectId,
    scopes: parsed.data.scopes,
  });
  await audit({
    userId: session.user.id,
    action: "pat.mint",
    target: minted.id,
    meta: { prefix: minted.prefix, projectId },
    ip: clientIp(req),
    ua: req.headers.get("user-agent") ?? undefined,
    success: true,
  });
  return NextResponse.json(minted, { status: 201 });
}

const RevokeInput = z.object({ id: z.string().min(1) });

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = RevokeInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 422 });
  }
  await revokePat({ userId: session.user.id, tokenId: parsed.data.id });
  await audit({
    userId: session.user.id,
    action: "pat.revoke",
    target: parsed.data.id,
    ip: clientIp(req),
    success: true,
  });
  return NextResponse.json({ ok: true });
}
