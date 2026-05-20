import { prisma } from "@/lib/db";

export async function audit(input: {
  userId?: string | null;
  action: string;
  target?: string | null;
  meta?: unknown;
  ip?: string | null;
  ua?: string | null;
  success: boolean;
  error?: string | null;
}) {
  try {
    await prisma.auditEvent.create({
      data: {
        userId: input.userId ?? undefined,
        action: input.action,
        target: input.target ?? undefined,
        meta: input.meta === undefined ? undefined : (input.meta as object),
        ip: input.ip ?? undefined,
        ua: input.ua ?? undefined,
        success: input.success,
        error: input.error ?? undefined,
      },
    });
  } catch (e) {
    // Audit failures should never break the caller; log and move on.
    console.error("audit.write_failed", input.action, e);
  }
}

export function clientIp(req: Request): string | undefined {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    undefined
  );
}
