# TokenShelf

A Behance-style showcase for AI engineering. Every project carries a
verifiable token-spend receipt — pulled directly from Anthropic, OpenAI,
GitHub, and friends — so "output per dollar" stops being a vibe.

```
project ── many ──▶ TokenReceipt
                       trustTier ∈ { VERIFIED, PROXIED, SELF_REPORTED }
                       responseHash + ed25519 signature for VERIFIED rows
```

See [PLAN.md](PLAN.md) for the architecture and milestone roadmap, and
[CLAUDE.md](CLAUDE.md) for the design rules.

## Stack

- Next.js 15 (App Router, RSC, Server Actions)
- TypeScript + Tailwind
- Auth.js v5 with the **GitHub** OAuth provider
- Prisma + Postgres
- Zod for API validation
- ed25519 receipt signatures + AES-256-GCM envelope encryption for at-rest secrets

## Quickstart

```bash
# 0. Postgres locally (or point DATABASE_URL at any Postgres):
docker run -d --name tokenshelf-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=tokenshelf postgres:16

# 1. Env — see .env.example for every var. Quick generation:
cp .env.example .env
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env
echo "ENCRYPTION_KEY=$(node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")" >> .env
echo "CRON_SECRET=$(openssl rand -hex 32)" >> .env
node -e "console.log('SIGNING_PRIVATE_KEY=\"' + require('crypto').generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}).replaceAll('\n','\\n') + '\"')" >> .env
# Fill in AUTH_GITHUB_ID / AUTH_GITHUB_SECRET manually.

# 2. Install + DB
pnpm install
pnpm prisma migrate dev --name init
pnpm db:seed

# 3. Dev
pnpm dev   # → http://localhost:3000
```

## GitHub OAuth app

Create one at <https://github.com/settings/developers>:

- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:3000/api/auth/callback/github`

Drop the client id/secret into `.env` as `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`.

## Routes

| Path | Notes |
| --- | --- |
| `/` | Public feed, sorted by verified receipts |
| `/u/[handle]` | Public profile |
| `/u/[handle]/[slug]` | Project detail with receipts table + trust badges |
| `/u/[handle]/[slug]/decisions` | Decision tab: model recommender, cache gap, peer benchmark |
| `/new` | Auth-gated: post a project |
| `/settings` | Profile + provider connections (envelope-encrypted) |
| `/settings/tokens` | Personal access token management |
| `POST /api/receipts` | Owner-only: post receipts via session **or** `Bearer tks_…` PAT |
| `POST /api/sync/[kind]` | Owner-only: pull usage from a connected provider |
| `POST /api/cron/sync-all` | Cron-only: nightly sync (Vercel) |
| `POST /api/pat` | Mint a Personal Access Token (session-only) |
| `GET /.well-known/tokenshelf-verify.json` | Public key for independent receipt verification |

## Providers

| Provider | What we pull | Endpoint |
| --- | --- | --- |
| **Anthropic** | per-bucket usage incl. cache reads / writes / service tier | `GET /v1/organizations/usage_report/messages` |
| **OpenAI** | bucketed completions usage; batch flag respected | `GET /v1/organization/usage/completions` |
| **GitHub** | repo-access verification (not a usage source today) | `GET /repos/{o}/{r}/collaborators/{u}/permission` |

All sync writes hit `(source, externalId)` uniqueness — re-running is safe.

## Posting a receipt with a PAT

```bash
# Mint a project-scoped token in /settings/tokens, then:
curl -X POST http://localhost:3000/api/receipts \
  -H "authorization: Bearer tks_..." \
  -H "content-type: application/json" \
  -d '{
    "source": "ANTHROPIC",
    "model":  "claude-sonnet-4-6",
    "inputTokens":  12000,
    "outputTokens": 3400,
    "cacheReadTokens": 9000
  }'
```

Or with the SDK wrapper:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { wrap } from "@tokenshelf/anthropic";
const anthropic = wrap(new Anthropic(), {
  projectSlug: "rag-eval-suite",
  apiToken: process.env.TOKENSHELF_TOKEN!,
});
```

## Verifying a receipt

Independent verifiers can:

1. `GET /.well-known/tokenshelf-verify.json` — pull our public key.
2. Take any TokenReceipt with `trustTier=VERIFIED`.
3. Recompute `responseHash = sha256(canonicalize(raw))`.
4. Verify `signature` covers `responseHash + "|" + externalId` under ed25519.

See [`src/lib/crypto/sign.ts`](src/lib/crypto/sign.ts) for the canonicalisation
algorithm.

## Roadmap

Tracked in [PLAN.md](PLAN.md). Today: M0–M2 partially shipped. Next big bets:

- M2: `EvalRun` + Pareto frontier for output vs. eval-score.
- M3: hosted gateway `gw.tokenshelf.dev` for real-time `PROXIED` receipts.

## Layout

```
src/
  app/                            # Next.js App Router
    api/{receipts,sync,cron,pat}/ # JSON endpoints
    .well-known/                  # Public verifier key
    u/[handle]/[slug]/decisions/  # Decision layer page
    settings/tokens/              # PAT management
  components/
    header.tsx
    project-card.tsx
    trust-badge.tsx
  lib/
    crypto/{envelope,sign}.ts     # AES-GCM + ed25519
    pricing/{anthropic,openai}.ts # rate cards
    sync/{anthropic,openai,github,index}.ts  # provider adapters + orchestrator
    decisions/{recommend-model,cache-gap,peer-benchmark}.ts
    pat/index.ts                  # Personal Access Tokens
    audit/index.ts                # AuditEvent writes
    format.ts, cn.ts, db.ts
  auth.ts                         # Auth.js config

packages/
  sdk-anthropic/                  # @tokenshelf/anthropic — drop-in wrap()

prisma/
  schema.prisma                   # source of truth
  seed.ts                         # demo data

vercel.json                       # nightly cron
```
