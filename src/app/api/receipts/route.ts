import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { resolvePat } from "@/lib/pat";
import { cost as priceCost } from "@/lib/pricing";
import { audit, clientIp } from "@/lib/audit";

const ProviderKinds = [
  "GITHUB",
  "ANTHROPIC",
  "OPENAI",
  "GOOGLE",
  "AZURE_OPENAI",
  "REPLICATE",
  "OTHER",
] as const;

const ReceiptInput = z.object({
  projectId: z.string().optional(),
  projectSlug: z.string().optional(),
  source: z.enum(ProviderKinds),
  model: z.string().min(1),
  serviceTier: z.string().optional(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
  /** Pass cents directly, OR omit to let the pricing table compute it. */
  costUsdCents: z.number().int().nonnegative().optional(),
  occurredAt: z.string().datetime().optional(),
  externalId: z.string().optional(),
  raw: z.unknown().optional(),
});

type AuthResult =
  | { kind: "session"; userId: string; projectId: string | null }
  | { kind: "pat"; userId: string; projectId: string | null }
  | { kind: "none" };

async function resolveAuth(req: Request): Promise<AuthResult> {
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer ")) {
    const tok = header.slice("Bearer ".length).trim();
    const pat = await resolvePat(tok);
    if (pat && pat.scopes.includes("receipts:write")) {
      return { kind: "pat", userId: pat.userId, projectId: pat.projectId };
    }
    return { kind: "none" };
  }
  const session = await auth();
  if (session?.user?.id) {
    return { kind: "session", userId: session.user.id, projectId: null };
  }
  return { kind: "none" };
}

export async function POST(req: Request) {
  const authn = await resolveAuth(req);
  if (authn.kind === "none") {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = ReceiptInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const data = parsed.data;

  // Resolve project. If using a project-scoped PAT, ignore client-provided
  // projectId / projectSlug — the PAT pins the project.
  let project = null as Awaited<ReturnType<typeof prisma.project.findUnique>>;
  if (authn.kind === "pat" && authn.projectId) {
    project = await prisma.project.findUnique({ where: { id: authn.projectId } });
  } else if (data.projectId) {
    project = await prisma.project.findUnique({ where: { id: data.projectId } });
  } else if (data.projectSlug) {
    project = await prisma.project.findUnique({
      where: { ownerId_slug: { ownerId: authn.userId, slug: data.projectSlug } },
    });
  }
  if (!project) {
    return NextResponse.json({ error: "project_not_found" }, { status: 404 });
  }
  if (project.ownerId !== authn.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const costUsdCents =
    data.costUsdCents ??
    (data.source === "ANTHROPIC" || data.source === "OPENAI"
      ? priceCost({
          provider: data.source,
          model: data.model,
          serviceTier: data.serviceTier ?? null,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          cacheReadTokens: data.cacheReadTokens,
          cacheWriteTokens: data.cacheWriteTokens,
        })
      : 0);

  try {
    const receipt = await prisma.$transaction(async (tx) => {
      const created = await tx.tokenReceipt.create({
        data: {
          projectId: project!.id,
          source: data.source,
          model: data.model,
          serviceTier: data.serviceTier,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          cacheReadTokens: data.cacheReadTokens,
          cacheWriteTokens: data.cacheWriteTokens,
          costUsdCents,
          occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
          externalId: data.externalId,
          trustTier: "SELF_REPORTED",
          raw: data.raw === undefined ? undefined : (data.raw as object),
        },
      });
      await tx.project.update({
        where: { id: project!.id },
        data: {
          totalInputTokens: { increment: data.inputTokens },
          totalOutputTokens: { increment: data.outputTokens },
          totalCacheReadTokens: { increment: data.cacheReadTokens },
          totalCacheWriteTokens: { increment: data.cacheWriteTokens },
          totalCostUsdCents: { increment: costUsdCents },
          receiptCount: { increment: 1 },
        },
      });
      return created;
    });

    await audit({
      userId: authn.userId,
      action: "receipt.create",
      target: receipt.id,
      meta: { authn: authn.kind, source: data.source, model: data.model },
      ip: clientIp(req),
      ua: req.headers.get("user-agent") ?? undefined,
      success: true,
    });

    return NextResponse.json({ ok: true, receipt }, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message ?? "unknown_error";
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") {
      return NextResponse.json(
        { ok: false, error: "duplicate_externalId" },
        { status: 409 },
      );
    }
    await audit({
      userId: authn.userId,
      action: "receipt.create",
      meta: { error: msg },
      success: false,
      error: msg,
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
