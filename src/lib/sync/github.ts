// GitHub adapter — not a token-usage source (mostly). Two jobs:
//   1. Verify the signed-in user has write access to a project's repoUrl,
//      so we can stamp `repoVerified=true` on the project.
//   2. (M2) Pull GitHub Models usage from /user/settings/billing/usage when
//      the user is a Copilot or Models subscriber.
//
// For repo verify we call:
//   GET /repos/{owner}/{repo}/collaborators/{username}/permission
// 200 + permission in {admin, maintain, write} = verified.

import type { ProviderSyncAdapter, UnifiedReceipt } from "./types";
import { AdapterError } from "./types";

const GITHUB_BASE = process.env.GITHUB_API_BASE ?? "https://api.github.com";

function parseRepoUrl(url: string): { owner: string; name: string } | null {
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.#?]+)/i);
  if (!m) return null;
  return { owner: m[1], name: m[2] };
}

export async function verifyRepoAccess(opts: {
  secret: string; // OAuth access token with "repo" scope, or a PAT
  repoUrl: string;
  username?: string;
}): Promise<{ ok: boolean; permission?: string; reason?: string }> {
  const parsed = parseRepoUrl(opts.repoUrl);
  if (!parsed) return { ok: false, reason: "unparseable_repo_url" };

  // Resolve the authenticated user's login if not provided.
  let username = opts.username;
  if (!username) {
    const me = await fetch(`${GITHUB_BASE}/user`, {
      headers: { Authorization: `Bearer ${opts.secret}`, "x-github-api-version": "2022-11-28" },
    });
    if (!me.ok) return { ok: false, reason: `auth_check_${me.status}` };
    const j = (await me.json()) as { login?: string };
    username = j.login;
    if (!username) return { ok: false, reason: "no_login_in_response" };
  }

  const res = await fetch(
    `${GITHUB_BASE}/repos/${parsed.owner}/${parsed.name}/collaborators/${username}/permission`,
    {
      headers: { Authorization: `Bearer ${opts.secret}`, "x-github-api-version": "2022-11-28" },
    },
  );
  if (res.status === 404) return { ok: false, reason: "not_a_collaborator" };
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AdapterError(`github permission: ${res.status}`, res.status, body);
  }
  const j = (await res.json()) as { permission?: string };
  const ok = !!j.permission && ["admin", "maintain", "write"].includes(j.permission);
  return { ok, permission: j.permission };
}

export const githubAdapter: ProviderSyncAdapter = {
  kind: "GITHUB",
  async *pull(): AsyncIterable<UnifiedReceipt> {
    // GitHub Models usage pull lives here in M2. For now this adapter is
    // verification-only; the orchestrator skips models that yield nothing.
    return;
  },
  async verify({ secret }) {
    const me = await fetch(`${GITHUB_BASE}/user`, {
      headers: { Authorization: `Bearer ${secret}`, "x-github-api-version": "2022-11-28" },
    });
    return { ok: me.ok, meta: { status: me.status } };
  },
};
