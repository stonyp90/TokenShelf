import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncAllForUser } from "@/lib/sync";
import { audit } from "@/lib/audit";

// Nightly cron entrypoint.
//
// Vercel Cron hits this with `Authorization: Bearer $CRON_SECRET`. The same
// header works locally for testing:
//
//   curl -X POST http://localhost:3000/api/cron/sync-all \
//     -H "Authorization: Bearer $CRON_SECRET"
//
// To register in production add to vercel.json:
//   { "crons": [{ "path": "/api/cron/sync-all", "schedule": "0 4 * * *" }] }

export const dynamic = "force-dynamic";
export const maxDuration = 300; // seconds, Vercel hobby max

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const users = await prisma.user.findMany({
    where: { providerConnections: { some: {} } },
    select: { id: true, handle: true },
  });
  const summaries: unknown[] = [];
  let okCount = 0;
  let failCount = 0;
  for (const u of users) {
    const result = await syncAllForUser(u.id);
    summaries.push({ user: u.handle ?? u.id, summaries: result });
    for (const r of result) (r.ok ? okCount++ : failCount++);
  }
  await audit({
    action: "cron.sync_all.complete",
    meta: { users: users.length, okCount, failCount, durationMs: Date.now() - started },
    success: failCount === 0,
  });
  return NextResponse.json({
    ok: failCount === 0,
    users: users.length,
    okCount,
    failCount,
    durationMs: Date.now() - started,
    summaries,
  });
}

// Allow GET for Vercel's cron preview UI as well; behaves identically.
export const GET = POST;
