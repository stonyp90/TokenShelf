import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const startedAt = new Date().toISOString();

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "tokenshelf",
      version: process.env.APP_VERSION ?? "dev",
      startedAt,
      now: new Date().toISOString(),
      region: process.env.AZURE_REGION ?? null,
    },
    {
      status: 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
