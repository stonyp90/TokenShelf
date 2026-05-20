# TokenShelf — Claude Operating Guide

A Behance-style showcase for AI engineering where every project carries a
verifiable token-spend receipt. See [README.md](README.md) and the architecture
plan in [PLAN.md](PLAN.md).

## Non-negotiable design rules

1. **Receipts are typed at the trust boundary, not the UI.** A `TokenReceipt`
   carries a `trustTier` (`VERIFIED | PROXIED | SELF_REPORTED`). UI must always
   show the tier — never present a self-reported number as if it were verified.
2. **Provider secrets never live in plaintext on disk.** All
   `ProviderConnection.secret` writes go through `src/lib/crypto/envelope.ts`.
   In production swap the local KMS for AWS/GCP KMS; the on-disk record format
   stays identical.
3. **Sync is idempotent.** `TokenReceipt` is unique on `(source, externalId)`.
   Adapters must synthesize a stable `externalId` from provider-stable inputs
   (request_id, bucket boundary + model + api_key_id) so re-runs are safe.
4. **Aggregates and receipts must agree.** `Project.totalInputTokens` etc. are
   denormalised. Every write path that touches `TokenReceipt` must update the
   matching project aggregate in the same transaction.
5. **Privacy-by-default.** Token *byte counts* are public; prompts and
   completions are private unless the project owner sets `storePrompts=true`.
   The proxy gateway (M3) honours this.
6. **No opaque ML in the decision layer.** Every recommendation is a pure
   function over the receipts table and a pricing table. If you can't explain
   it from `priceLookup()`, it doesn't ship.
7. **`/api/cron/*` requires `Authorization: Bearer $CRON_SECRET`.** Never relax
   this — production crons run with the same secret as local dev tests.
8. **Audit every privileged action.** Provider connect/disconnect, sync runs,
   PAT mint/revoke. The `audit()` helper in `src/lib/audit/` is the only path.

## Workflow

1. **Explore.** Read `prisma/schema.prisma` and `src/lib/sync/types.ts` before
   touching any sync code. The data model answers most "where does this go".
2. **Plan.** For non-trivial features write to `PLAN.md` first. Cite which
   milestone (M1/M1.5/M2/M3) the change belongs to.
3. **Implement.** Pure logic in `src/lib/{decisions,pricing,sync}/`. UI in
   `src/components/` and `src/app/`. Avoid sprinkling provider HTTP calls
   anywhere outside `src/lib/sync/`.
4. **Test.** `pnpm typecheck && pnpm build`. (Unit tests TBD — when added, run
   `pnpm test`.)
5. **Verify.** Locally with `pnpm dev`; check the project page + decisions tab
   render with the seed data.

## Commands cheat-sheet

```bash
pnpm dev            # http://localhost:3000
pnpm typecheck      # tsc --noEmit
pnpm build          # prisma generate && next build
pnpm db:push        # apply schema without migration history (dev only)
pnpm db:migrate     # create + apply a migration
pnpm db:seed        # demo users + projects + receipts
pnpm db:studio      # browser DB explorer
```

Provider-side smoke tests (with real keys, against your `.env`):

```bash
# Manual sync for a single project
curl -X POST 'http://localhost:3000/api/sync/anthropic?projectSlug=rag-eval-suite' \
  -b "$(cat /tmp/tokenshelf-session-cookie)"

# Trigger the nightly cron locally
curl -X POST http://localhost:3000/api/cron/sync-all \
  -H "Authorization: Bearer $CRON_SECRET"

# Mint a PAT, then post a receipt with it
curl -X POST http://localhost:3000/api/pat \
  -H 'content-type: application/json' \
  -d '{"name":"laptop","projectSlug":"rag-eval-suite"}'  # returns { token: "tks_…" }
curl -X POST http://localhost:3000/api/receipts \
  -H "Authorization: Bearer tks_…" \
  -H 'content-type: application/json' \
  -d '{"source":"ANTHROPIC","model":"claude-sonnet-4-6","inputTokens":1234,"outputTokens":56}'
```

## Repo layout (the load-bearing files)

- `prisma/schema.prisma` — single source of truth for the data model.
- `src/lib/sync/` — provider adapters (one file per provider) + orchestrator.
- `src/lib/pricing/` — rate cards; `cost()` is the only allowed pricing path.
- `src/lib/crypto/` — `envelope.ts` for at-rest secrets, `sign.ts` for receipts.
- `src/lib/decisions/` — pure-function decision layer (model recommender, etc.).
- `src/lib/pat/` — Personal Access Tokens (mint + resolve).
- `src/lib/audit/` — `audit()` writes to `AuditEvent`.
- `src/app/api/sync/[kind]/route.ts` — per-provider manual sync.
- `src/app/api/cron/sync-all/route.ts` — nightly cron (Vercel-compatible).
- `src/app/api/receipts/route.ts` — programmatic ingest (session or PAT).
- `src/app/.well-known/tokenshelf-verify.json/route.ts` — public verifier key.
- `packages/sdk-anthropic/` — `@tokenshelf/anthropic` workspace package.

## Common pitfalls

- **Don't pass plaintext secrets to Prisma.** Always call `encryptSecret()`
  first; store in `ProviderConnection.secretCipher`.
- **Don't fetch `ProviderConnection.secretCipher` to the client.** Server only.
- **Don't recompute project aggregates by re-reading receipts.** Increment in
  the same transaction as the receipt write. Backfill jobs exist for repairs.
- **Pricing drift.** If a sync adapter encounters an unknown model id, it
  writes the receipt with cost=0 — investigate `src/lib/pricing/*.ts`.
- **Webhook signature verification (M2).** Each provider has its own header.
  Validate before doing anything; never trust the body alone.

## Roadmap pointer

`PLAN.md` is the durable plan. Milestones today:

- **M0 ✅** — scaffold, manual receipts, public showcase.
- **M1 ✅** — Anthropic + OpenAI Admin sync, KMS-style envelope encryption,
  ed25519 receipt signatures, trust tiers.
- **M1.5 ✅** — Personal Access Tokens + SDK middleware (`@tokenshelf/anthropic`).
- **M2** — Decision layer (started: model recommender, cache gap, peer
  benchmark). Next: EvalRun + Pareto frontier.
- **M3** — Proxy gateway (`gw.tokenshelf.dev`), separate Rust service.
