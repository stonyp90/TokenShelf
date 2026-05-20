# TokenShelf — Cutting-edge Provider Integration & Decision Plan

> Status: proposal. Read together with [README.md](README.md). MVP (M0) is shipped:
> data model, auth, feed, profile, project, manual receipts. This doc covers
> **M1 → M3**: making receipts real (provider sync), making them trustworthy
> (verification), and making them useful (the decision layer).

## North star

> *"You can't claim cost-efficiency without showing the receipt. TokenShelf is
> the place engineers ship that receipt, and the place they figure out where
> their next dollar should go."*

Two outcomes everything in this plan ladders up to:

1. **Receipts are real.** Every TokenReceipt on a public project is either
   (a) signed by TokenShelf after we pulled it from the provider's own usage
   API, or (b) clearly marked "self-reported". No silent claims.
2. **Receipts are actionable.** A project page doesn't just show *how much* —
   it shows *what to do about it*: cheaper model candidates, cache-hit gaps,
   peer benchmarks, provider arbitrage.

## 1. Ingestion architecture — four patterns

There is no single "right" way to record token usage. We support four, ordered
by intrusiveness vs. fidelity.

| # | Pattern | Latency | Fidelity | User effort | When it wins |
|---|---|---|---|---|---|
| A | **Polled provider sync** (Admin/Usage APIs) | hours | high (provider truth) | one-time OAuth/key | engineer already shipped; just connect & import |
| B | **Webhook push** (where supported) | seconds | high | one-time setup | provider supports it (Anthropic event webhooks, OpenAI org events) |
| C | **Proxy ingestion** (TokenShelf-hosted gateway) | real-time | per-request truth + prompts (optional) | route traffic | engineers building right now and want live receipts |
| D | **SDK / CLI middleware** | real-time | per-request | install package | local dev, low-volume scripts |

**Recommended sequence**: ship A first (Anthropic Admin + OpenAI Usage), then D
(SDK middleware — fastest user adoption, no infra), then C (proxy gateway —
high moat, monetisable). B (webhooks) we adopt opportunistically as providers
expose them.

### A — Polled provider sync (M1)

Architecture:

```
┌─────────────┐    nightly       ┌──────────────┐    /v1/.../usage_report
│  cron       │ ───trigger────▶  │ sync worker  │ ──────────────────────▶  Anthropic
│ (Vercel CR / │                  │ (Node task)  │    /v1/organization/usage  OpenAI
│  GH Actions)│                  └──────┬───────┘    /user/settings/billing GitHub
└─────────────┘                         │
                                        ▼
                              ┌────────────────────┐
                              │ TokenReceipt write │  verified=true, externalId=<provider request_id>
                              │ Project aggregate  │
                              └────────────────────┘
```

- Worker lives in `src/lib/sync/` (one file per provider) behind a uniform
  `ProviderSyncAdapter` interface.
- Triggered by `/api/sync/[kind]` (per-user manual sync) **and** a cron
  endpoint `/api/cron/sync-all` that iterates active `ProviderConnection`s.
- Idempotency: `(externalId, source)` is unique — we never write the same
  provider record twice. Schema change: add `@@unique([externalId, source])` on
  `TokenReceipt`.

### B — Webhook push (M2, opportunistic)

When a provider exposes usage events (Anthropic's "events API" for org-level
billing events; OpenAI's webhooks), we register a callback at
`/api/webhooks/[provider]` and write receipts on receipt. Verify with the
provider's signature header (`anthropic-signature`, etc.).

### C — Proxy ingestion (M3, the big bet)

TokenShelf hosts an LLM API proxy at `https://gw.tokenshelf.dev/<provider>/<rest>`.
Engineers swap `https://api.anthropic.com` → our gateway in one line; we forward
the request with their stored key, observe the response, write a receipt.

- This is the Helicone/Portkey/OpenRouter pattern, but specialised for
  *showcase*: every observed request can be auto-attached to a project.
- Adds a real moat — we now own the data plane, not just the reporting plane.
- Privacy guardrails: prompts and completions are **never** stored unless the
  user opts in per-project. We only need byte counts + model + cost.

### D — SDK / CLI middleware (M1.5)

Two tiny libraries:

- `@tokenshelf/anthropic` — drop-in wrapper around `@anthropic-ai/sdk`:

  ```ts
  import Anthropic from "@anthropic-ai/sdk";
  import { wrap } from "@tokenshelf/anthropic";
  const client = wrap(new Anthropic(), { projectSlug: "rag-eval-suite" });
  ```

  On every response, post the usage block to `/api/receipts` with a personal
  access token. Cost computed locally from the model's price card.

- `tokenshelf` CLI (Rust, like `rtk`) — `tokenshelf wrap claude -- ...` records
  any subcommand's stdout/stderr for tokens reported. Useful for Claude Code
  sessions, evals, and CI runs.

## 2. Provider integration matrix

Each adapter must implement:

```ts
interface ProviderSyncAdapter {
  kind: ProviderKind;
  // Pull usage records since `since`, returning unified receipts.
  pull(opts: { secret: string; since: Date; until: Date }): AsyncIterable<UnifiedReceipt>;
  // Translate provider's model id → canonical price.
  price(model: string, tokens: { input: number; output: number; cacheRead?: number; cacheWrite?: number }): number; // cents
  // Optional: handle a webhook payload.
  handleWebhook?(req: Request): Promise<UnifiedReceipt[]>;
}
```

### Anthropic (priority 1)

- **Endpoint**: `GET /v1/organizations/usage_report/messages` (Admin API).
- **Auth**: `x-api-key: sk-ant-admin-…` — admin keys, separate from regular
  API keys. Stored encrypted in `ProviderConnection.secret`.
- **Granularity**: per-request rows with `input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, `cache_read_input_tokens`, `service_tier`,
  `model`, `workspace_id`, `api_key_id`, `request_id`, timestamps.
- **Cost**: compute locally from a price table (`src/lib/pricing/anthropic.ts`)
  keyed by `(model, service_tier)`. Cache reads at 10% of input, cache writes
  at 125% — make this visible in the UI.
- **Verification**: store `request_id` as `externalId`. Mark `verified=true`.
- **Cutting-edge angle**: surface **cache hit rate** prominently
  (`cache_read / (cache_read + input)`). Most users don't realise how much
  caching is leaving on the table.

### OpenAI (priority 1)

- **Endpoints**: `GET /v1/organization/usage/completions`,
  `/usage/embeddings`, `/usage/images`, `/usage/audio_speeches`,
  `/usage/audio_transcriptions`, plus `/organization/costs`.
- **Auth**: `Authorization: Bearer sk-admin-…` (admin keys).
- **Granularity**: bucketed (1m/1h/1d). We pull at 1h granularity by default;
  cost comes from `/costs` for the same buckets.
- **Cost reconciliation**: usage endpoints don't return USD directly — join
  with `/costs` on time bucket. Code lives in `src/lib/sync/openai.ts`.
- **Cutting-edge angle**: split out **Batch API** spend (50% discount) and
  **prompt cache** spend so engineers see the real effective rate per model.

### GitHub (priority 1 — needed for the "showcase" half)

- Used for two things:
  1. **Repo verification** — a Project with `repoUrl` is "GitHub-verified" if
     the connected user has push access to it. Pull via
     `GET /repos/{owner}/{repo}/collaborators/{username}/permission`.
  2. **Commit/eval evidence** — pull README, LICENSE, latest commits, contributors,
     stars. Shown on the project page as a sidebar.
- **GitHub Models** usage (free + paid tiers) is also pulled here as receipts
  when available.
- OAuth scope already includes `repo` (set in `src/auth.ts`).

### Google / Vertex AI (priority 2)

- **Endpoint**: Cloud Billing API `services.skus.list` + BigQuery billing
  export for per-request granularity.
- Requires the user to set up billing export (one-time). Worth the friction
  because Gemini users are price-sensitive.

### Azure OpenAI (priority 2)

- **Endpoint**: Azure Cost Management `Query` API, filtered by service.
- Per-deployment usage available via the deployment's own metrics.

### Replicate (priority 3)

- Each prediction includes `metrics.predict_time` and a per-model rate.
- Pull via `GET /v1/predictions?created_after=…`.

### Bedrock, Together, Groq, Fireworks (priority 3, batch later)

- All have usage endpoints; adapter pattern makes them ~1 day each once the
  framework is solid.

## 3. The decision layer — why TokenShelf isn't just a dashboard

Every project page gets a **Decisions** tab with four panels. All are derived
purely from receipts + a pricing service; no opaque ML required at first.

### 3.1 Model recommender

For each `(workload signature, model used)`, show the same workload's cost on
2-3 alternative models. Workload signature = `(avg input tokens, avg output
tokens, cache-hit %, model family)`. Pricing service does the rest.

> "Your 412k-input / 64k-output workload would cost $14.20 on Sonnet vs.
> $28.40 on Opus. Sonnet matched Opus on 81% of similar tasks in TokenShelf
> peer data — link."

Implementation: `src/lib/decisions/recommend-model.ts`. Pure function over
the receipts table and a static `pricing/` table.

### 3.2 Cache-hit gap

Anthropic + OpenAI both expose cache reads. If a project's cache-hit rate is
< the median for its model family, surface a callout linking to docs.

### 3.3 Peer benchmark

For each project, compute its tag vector and find the nearest k=5 projects.
Show median tokens & USD for that cluster, and where this project sits.

> "Among `rag`-tagged projects of similar token-volume, you're in the cheapest
> 25%. Top performer: @ada/rag-eval-suite at 38% of your $/output-token."

### 3.4 Eval-vs-cost frontier (M2)

If a project also publishes eval scores (we'll add `EvalRun` model), plot it
on a Pareto frontier alongside peers. This is the killer chart for the
"output per token spend" thesis.

## 4. Verification — making a receipt mean something

Three trust tiers, shown as a badge on each receipt:

| Tier | What it means | How we earn it |
|---|---|---|
| 🟢 **Verified** | Pulled directly from the provider's API, signed by TokenShelf | adapters in M1 |
| 🟡 **Proxied** | Observed by our gateway at the moment of the call | M3 proxy |
| ⚪ **Self-reported** | User typed it in or POSTed it | default for `/api/receipts` |

### Verification record

When we pull from an Admin API we store:

```jsonc
// TokenReceipt.raw
{
  "provider": "anthropic",
  "endpoint": "/v1/organizations/usage_report/messages",
  "fetchedAt": "2026-05-20T12:34:56Z",
  "fetchedBy": "sync-worker@tokenshelf",
  "externalId": "req_01H…",                  // provider request_id
  "responseHash": "sha256:…",                // hash of the raw row
  "signature": "ed25519:…"                   // TokenShelf-signed proof
}
```

This lets a third party replay verification: hash the row, check the signature
against our published verifier key. The badge endpoint
(`/badge/u/[handle]/[slug]/verify`) returns a verification page.

## 5. Security — keys and secrets

The MVP stores `ProviderConnection.secret` in plaintext. Before M1 launch:

- **Envelope encryption**. Per-row `secret` is encrypted with a per-user DEK;
  DEK is wrapped with KMS (AWS KMS, GCP KMS, or Cloudflare Workers' Vault).
  See [`src/lib/crypto/envelope.ts`](src/lib/crypto/envelope.ts) (to create).
- **Read-only keys preferred**. Anthropic admin keys, OpenAI admin keys —
  both can be read-only. Document this clearly in `/settings`.
- **Scoped permissions**. The sync worker's IAM only allows `kms:Decrypt`
  against the data-key alias, nothing else.
- **Per-project receipt PATs**. M1.5: issue `tks_…` tokens that can only
  POST receipts to a single project. SDK middleware uses these; user's
  real provider keys never leave their machine.
- **Rate limits**. `/api/receipts` and `/api/sync/*` rate-limited per user
  (sliding window in Redis / Upstash KV).
- **Audit log**. Every sync run writes an `AuditEvent` row with
  `(actor, action, target, timestamp, ip, success, error)`.

## 6. Data model evolution

Additions on top of [prisma/schema.prisma](prisma/schema.prisma):

```prisma
model TokenReceipt {
  // ...existing fields
  serviceTier        String?    // "standard" | "batch" | "scale"
  cacheReadTokens    Int        @default(0)
  cacheWriteTokens   Int        @default(0)
  trustTier          TrustTier  @default(SELF_REPORTED)
  responseHash       String?
  signature          String?

  @@unique([source, externalId])  // idempotent provider sync
}

enum TrustTier { VERIFIED PROXIED SELF_REPORTED }

model EvalRun {
  id        String   @id @default(cuid())
  projectId String
  suite     String   // "swe-bench-lite", "mmlu", custom slug
  score     Float    // 0..1
  details   Json
  occurredAt DateTime @default(now())
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

model PersonalAccessToken {
  id        String   @id @default(cuid())
  userId    String
  projectId String?  // nullable = account-wide
  prefix    String   @unique         // first 8 chars for display
  hash      String                   // bcrypt(rest)
  scopes    String[] @default([])    // ["receipts:write"]
  createdAt DateTime @default(now())
  lastUsedAt DateTime?
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  project Project? @relation(fields: [projectId], references: [id], onDelete: SetNull)
}

model AuditEvent {
  id        String   @id @default(cuid())
  userId    String?
  action    String   // "sync.anthropic.start" | "receipt.create" | ...
  target    String?
  meta      Json?
  ip        String?
  success   Boolean
  error     String?
  createdAt DateTime @default(now())

  @@index([userId, createdAt])
}
```

## 7. Delivery milestones

### M0 — Shipped ✅

Scaffold, auth, manual receipts, basic feed/profile/project.

### M1 — Shipped ✅ — Verified receipts

- Provider adapters: Anthropic Admin, OpenAI Usage, GitHub repo verify.
- AES-256-GCM envelope encryption for `ProviderConnection.secretCipher`
  (swap to AWS/GCP KMS by changing one function).
- `/api/sync/[kind]` real, idempotent on `(source, externalId)`.
- `/api/cron/sync-all` gated by `CRON_SECRET`, registered in `vercel.json`.
- `TrustTier` enum + UI badges (VERIFIED / PROXIED / SELF_REPORTED).
- ed25519 signatures + `/.well-known/tokenshelf-verify.json` for independent verification.
- `AuditEvent` writes on every privileged action.

### M1.5 — Shipped ✅ — PATs + SDK middleware

- `PersonalAccessToken` model + `/settings/tokens` UI.
- `/api/receipts` accepts `Authorization: Bearer tks_…` in addition to session.
- `@tokenshelf/anthropic` workspace package — drop-in `wrap()`.

### M2 — Shipped (partial) ✅ — Decision layer + evals

- Decisions tab live at `/u/[handle]/[slug]/decisions`:
  - Model recommender (Anthropic + OpenAI families)
  - Prompt-cache gap with savings estimate
  - Peer benchmark by tag overlap
- `EvalRun` model + `POST /api/evals` (session or PAT) + tab on Decisions page.
- Pricing service across 6 providers (Anthropic, OpenAI, Google, Azure-OpenAI,
  Replicate, Bedrock). Refresh-from-rate-cards cron still TODO.

### M3 — Shipped (inside Next.js, not yet a separate Rust service) ✅

- **Proxy gateway** at `/api/gw/[provider]/[...path]` — engineers point their
  SDK at TokenShelf's URL with a PAT, we proxy to the upstream with their
  stored real key and write a `PROXIED` receipt on every observed response.
- Streaming support (Anthropic + OpenAI SSE) with usage parsed from the
  final stream chunk.
- Privacy gate: prompts/completions only persisted when
  `project.storePrompts=true`.
- A standalone Rust service (`tokenshelf-gateway`) remains in scope for
  operational hardening (rate limiting per-org, geo distribution), but the
  Next.js gateway is enough for launch.

### Marketplace ✅ (new milestone, not in the original plan)

- `Listing` (kinds: TEMPLATE / AGENT / PROMPT_PACK / EVAL_SUITE / SERVICE)
  with `License` enum.
- `/marketplace` browses active listings; cards show receipt + verified%.
- Owner: `/u/[handle]/[slug]/list` create/edit; Buy button on project pages.
- `Order` model + `/orders` + `/orders/[id]` with Stripe-stub completion.
- Public read API (`/api/v1/*`) so external tools can build on the data.
- Embeddable SVG badge at `/badge/u/[h]/[s]` for README inclusion.

### Social ✅

- `Follow` + `Favorite`. Profile shows follower count; project shows favorite count.

### What's next (post-launch backlog)

- **Real Stripe** (Checkout + Connect for seller payouts; refund flow).
- **Webhook ingestion** for providers that support it (push instead of polled).
- **Vertex billing-export adapter** for Google (BigQuery integration).
- **Standalone Rust gateway** with per-org rate limiting + geo presence.
- **Pareto chart** on the Decisions tab (cost × eval score).
- **Auto-refresh pricing tables** from public rate cards.
- **Notifications** (webhooks + email) for marketplace events.

## 8. Open questions (need a call before M1 starts)

1. **Where does the cron live?** Vercel Cron is the path of least resistance;
   GitHub Actions is free and we already use GH for auth. Recommend Vercel
   Cron — same deploy unit as the app.
2. **Self-hosted vs managed Postgres?** Recommend Neon for dev/staging, then
   evaluate based on receipt volume. Switch criteria: > 10M receipt rows.
3. **Do we expose the decision layer as an API too?** I.e., can other tools
   query "what's the cheaper model for this workload"? Recommend **yes, M2+** —
   that's how we get embedded in dev tools.
4. **Do verified receipts also reveal model prompts?** Recommend **no, never
   by default**. Only the byte counts + metadata go public. Opt-in per-project
   for prompts.

## 9. Appendix — file layout after M1

```
src/
  lib/
    sync/
      index.ts                 # registry + cron entrypoint
      anthropic.ts             # Admin API pull
      openai.ts                # Usage + Costs pull
      github.ts                # repo verify + Models pull
      google.ts                # Vertex (M2)
      azure.ts                 # Azure OpenAI (M2)
      replicate.ts             # M2
    pricing/
      anthropic.ts             # model → ¢/Mtok table (auto-refreshed)
      openai.ts
      ...
    crypto/
      envelope.ts              # KMS wrap/unwrap
      sign.ts                  # ed25519 receipt signing
    decisions/
      recommend-model.ts
      cache-gap.ts
      peer-benchmark.ts
  app/
    api/
      cron/sync-all/route.ts   # invoked by Vercel Cron
      webhooks/[provider]/route.ts
      pat/route.ts             # mint personal access tokens
    settings/
      tokens/page.tsx          # PAT management
```
