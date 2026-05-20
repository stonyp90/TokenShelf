// SVG badge — link this from a project README to show a live receipt:
//
//   ![tokens](https://tokenshelf.dev/badge/u/ada/rag-eval-suite)
//
// The image is regenerated on each request (force-dynamic) so the badge
// always reflects the latest aggregates. Cached for 5 minutes at the edge.

import { prisma } from "@/lib/db";
import { formatTokens, formatUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function badge(left: string, right: string, ok: boolean): string {
  const leftWidth = 75;
  const rightWidth = Math.max(60, right.length * 7 + 14);
  const total = leftWidth + rightWidth;
  const color = ok ? "#22c55e" : "#f59e0b";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${escapeXml(left)}: ${escapeXml(right)}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftWidth}" height="20" fill="#1f2937"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${color}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="11">
    <text x="${leftWidth / 2}" y="15">${escapeXml(left)}</text>
    <text x="${leftWidth + rightWidth / 2}" y="15">${escapeXml(right)}</text>
  </g>
</svg>`;
}

export async function GET(_req: Request, context: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await context.params;
  const owner = await prisma.user.findUnique({ where: { handle } });
  let svg: string;
  if (!owner) {
    svg = badge("tokenshelf", "not found", false);
  } else {
    const project = await prisma.project.findUnique({
      where: { ownerId_slug: { ownerId: owner.id, slug } },
    });
    if (!project) {
      svg = badge("tokenshelf", "not found", false);
    } else {
      const verifiedShare =
        project.receiptCount === 0
          ? 0
          : Math.round((project.verifiedReceiptCount / project.receiptCount) * 100);
      const out = `${formatTokens(project.totalOutputTokens)} · ${formatUsd(project.totalCostUsdCents)}${
        verifiedShare > 0 ? ` · ${verifiedShare}%✓` : ""
      }`;
      svg = badge("token-shelf", out, verifiedShare >= 50);
    }
  }
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}
