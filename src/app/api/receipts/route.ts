import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

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
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsdCents: z.number().int().nonnegative().default(0),
  occurredAt: z.string().datetime().optional(),
  externalId: z.string().optional(),
  verified: z.boolean().default(false),
  raw: z.unknown().optional(),
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
  const parsed = ReceiptInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const data = parsed.data;

  // Resolve project by id or by (ownerId, slug).
  const project = data.projectId
    ? await prisma.project.findUnique({ where: { id: data.projectId } })
    : data.projectSlug
      ? await prisma.project.findUnique({
          where: { ownerId_slug: { ownerId: session.user.id, slug: data.projectSlug } },
        })
      : null;
  if (!project) {
    return NextResponse.json({ error: "project_not_found" }, { status: 404 });
  }
  if (project.ownerId !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const receipt = await prisma.$transaction(async (tx) => {
    const created = await tx.tokenReceipt.create({
      data: {
        projectId: project.id,
        source: data.source,
        model: data.model,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        costUsdCents: data.costUsdCents,
        occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
        externalId: data.externalId,
        verified: data.verified,
        raw: data.raw === undefined ? undefined : (data.raw as object),
      },
    });
    await tx.project.update({
      where: { id: project.id },
      data: {
        totalInputTokens: { increment: data.inputTokens },
        totalOutputTokens: { increment: data.outputTokens },
        totalCostUsdCents: { increment: data.costUsdCents },
        receiptCount: { increment: 1 },
      },
    });
    return created;
  });

  return NextResponse.json({ ok: true, receipt }, { status: 201 });
}
