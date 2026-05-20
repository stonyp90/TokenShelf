# TokenShelf

A Behance-style showcase for AI engineering. Every project carries a
verifiable token-spend receipt — pulled (eventually) straight from Anthropic,
OpenAI, GitHub Models, and friends — so "output per dollar" stops being a vibe.

```
project ── many ──▶ TokenReceipt
                       (provider, model, input/output tokens, USD, verified?)
```

## Stack

- Next.js 15 (App Router, RSC, Server Actions)
- TypeScript + Tailwind
- Auth.js v5 with the **GitHub** OAuth provider (more to come)
- Prisma + Postgres
- Zod for API validation

## Quickstart

```bash
# 0. Postgres locally (or point DATABASE_URL at any Postgres):
docker run -d --name tokenshelf-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=tokenshelf postgres:16

# 1. Env
cp .env.example .env
# Fill in: AUTH_SECRET, AUTH_GITHUB_ID, AUTH_GITHUB_SECRET

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

| Path                    | Notes                                                   |
| ----------------------- | ------------------------------------------------------- |
| `/`                     | Public feed of latest projects                          |
| `/u/[handle]`           | Public profile                                          |
| `/u/[handle]/[slug]`    | Project detail with receipts table                      |
| `/new`                  | Auth-gated: post a project                              |
| `/settings`             | Auth-gated: handle, bio, provider connections           |
| `POST /api/receipts`    | Owner-only: add a token receipt (programmatic ingest)   |
| `POST /api/sync/[kind]` | Owner-only: pull usage from a connected provider (stub) |

### Posting a receipt programmatically

```bash
curl -X POST http://localhost:3000/api/receipts \
  -H "content-type: application/json" \
  -b "<your session cookie>" \
  -d '{
    "projectSlug": "rag-eval-suite",
    "source": "ANTHROPIC",
    "model": "claude-opus-4-7",
    "inputTokens": 12000,
    "outputTokens": 3400,
    "costUsdCents": 88,
    "verified": true
  }'
```

## Roadmap (post-MVP)

- **Provider sync adapters** under `src/lib/providers/{anthropic,openai,github}.ts` —
  pull real usage on a cron and tag receipts as `verified`.
- **Personal access tokens** for `/api/receipts` so CI can post receipts without
  a browser session.
- **Encrypted secrets** — `ProviderConnection.secret` is plaintext today; wrap
  with KMS-backed envelope encryption before any real deployment.
- **Pairwise / Elo ranking** between projects with similar token budgets.
- **Embeddable badge** (`<img src="…/badge/u/handle/slug">`) so engineers can
  link the receipt from their own README.

## Layout

```
src/
  app/
    page.tsx                  # feed
    layout.tsx
    globals.css
    u/[handle]/page.tsx       # profile
    u/[handle]/[slug]/page.tsx  # project
    new/page.tsx              # create project (server action)
    settings/page.tsx         # profile + provider connections
    api/
      auth/[...nextauth]/route.ts
      receipts/route.ts
      sync/[kind]/route.ts
  components/
    header.tsx
    project-card.tsx
  lib/
    db.ts                     # prisma singleton
    format.ts                 # token / USD formatters
    cn.ts
  auth.ts                     # Auth.js config
prisma/
  schema.prisma
  seed.ts
```
