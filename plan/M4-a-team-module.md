# PLAN — M4 · TokenShelf for a.team

> **Status:** draft build plan, not committed scope. Architecture and
> security companions: [`pitch/a-team-architecture.md`](../pitch/a-team-architecture.md),
> [`pitch/a-team-security.md`](../pitch/a-team-security.md). Exec
> proposal: [`pitch/a-team.pdf`](../pitch/a-team.pdf).

## 0. Mission and guardrails

Embed TokenShelf as a.team's productivity-proof layer. A small
open-source daemon (fork of RTK, Apache-2.0) runs on consenting
builders' machines, captures verifiable per-session signals,
encrypts at the source, and surfaces a builder-owned score across four
contexts (personal projects, a.team interviews, a.team engagements,
client-accepted projects). Builders adopt for the token-savings;
a.team gains the productivity proof as the network adopts.

**Non-negotiables for every PR in M4.**

1. **TDD / BDD.** Every domain rule lands as a failing test first.
2. **Hexagonal.** Domain has zero imports from `pg`, `aws-sdk`, `next`,
   `react`, `sodiumoxide`. Adapters depend on domain; never the inverse.
3. **`docker compose up` is the entry point.** No external accounts
   required to run the stack end-to-end.
4. **Design tokens only.** No hardcoded colors in components. All
   colors flow through `--color-*` CSS custom properties defined in
   `src/app/globals.css`.
5. **Document architecture in every PR.** PR description names the
   ports/adapters touched and any seam moves.
6. **Sub-agents for genuinely independent work.** The parallel tracks
   in §10 are the candidates.
7. **No claim ships that can't be defended.** Pitch-doc claim audit
   applies to product copy too — "zero latency" replaced with "no
   latency penalty" pattern.

---

## 1. Phasing overview

| Phase | Name | What ships | Gate to next |
|---|---|---|---|
| **M4.0** | Foundation | Test runner, docker-compose stack, design tokens, hexagonal scaffolding (`src/lib/m4/{domain,ports,adapters,services}`), CI for TS + Rust | `pnpm test` passes; `docker compose up` brings up the full stack; lint blocks raw hex colors |
| **M4.1** | Daemon skeleton (fork) | `tokenshelf-agent` repo forked from RTK, renamed, NOTICE + LICENSE hygiene, Sigstore signing on releases, `ReceiptSink` trait seam added with no behavior change | Daemon builds on macOS/Linux/Windows; upstream weekly merge cron in place |
| **M4.2** | Sealed ingest path | Daemon emits sealed-box envelopes; ingest API stores ciphertext; per-engagement KEK lifecycle; consent gate enforced | BDD: "builder opts in → sealed receipt arrives → ingest API can't decrypt" green |
| **M4.3** | Objective scoring | Schema additions; pure-function score computation from receipts + GitHub events; builder private dashboard | BDD: "builder views their own score" green; score is reproducible from inputs |
| **M4.4** | Evaluator pipeline | Sandboxed evaluator decrypts blob → redactor → score → judge sanity layer; transparency-log anchoring | BDD: "evaluator runs in isolated VM, no egress except pinned LLM" green |
| **M4.5** | UI surfaces | Builder public profile (opt-in), a.team admin view, buyer-facing snapshot, consent UI | BDD: "What a.team sees / What buyers see" parity with pitch page 2 |
| **M4.6** | Production hardening | KMS rotation runbook, SLSA L3, key-person source escrow filing, SOC 2 scoping, jurisdiction memo | External pen-test report green |

Phases are sequenced. Inside each phase, tracks run in parallel (§10).

---

## 2. Hexagonal architecture

The domain is framework-free. Ports are interfaces; adapters are
swappable per environment.

### 2.1 Domain entities

`src/lib/m4/domain/` (TypeScript), `crates/agent-core/src/domain/`
(Rust).

| Entity | Key invariants |
|---|---|
| `Engagement` | `retentionDays ≥ 14`; `evaluatorPubKey` matches transparency-log entry; status monotonic (`ACTIVE → WOUND_DOWN`) |
| `ConsentGrant` | `revokedAt > grantedAt`; `publicProfileOptIn=true` required before any data appears under `/p/`; `capture.tools ⊆ rubric.allowlist` |
| `Session` | Captured iff non-revoked consent covers `(engagementId, builderId, tool)` at `startedAt`; `endedAt ≥ startedAt`; byte counts frozen after blob upload |
| `Receipt` | Extends existing `TokenReceipt`; adds `trustTier: 'PROXIED_LOCAL'` and `sessionId`; idempotent on `blake3(engagementId || sessionId || sequence)` |
| `Score` | `composite ∈ [0,1]`; `sum(weights) === 1.0`; immutable once `anchoredAt` set; `rubricRef` matches engagement's at `computedAt` |
| `BuilderProfile` | Derived read model; includes only engagements where `consent.publicProfileOptIn === true` |
| `AuditEvent` | Append-only; hash-chained; subtypes `DEEP_AUDIT_READ`, `KMS_UNWRAP`, `CONSENT_REVOKED`, `EVALUATOR_PUBKEY_ROTATED`, `RECEIPT_INGESTED` |

### 2.2 Ports

TypeScript port stubs land in `src/lib/m4/ports/`. Rust port traits
land in `crates/agent-core/src/ports/`.

| Port | Used by | Production adapter | Test / local adapter |
|---|---|---|---|
| `CaptureSource` (Rust) | daemon | `OtlpCollectorSource` (Claude Code OTel), `AiderLogTailSource`, `CcusageSource` (RTK inherited) | `FixtureFileSource` |
| `Redactor` | daemon + evaluator | `OpenRedactorAdapter` (regex + entity-NER) | `IdentityRedactor`, `DeterministicRedactor` |
| `Sealer` (Rust) | daemon | `LibsodiumSealer` (`sodiumoxide::sealedbox`) | `XorSealer` (test-only) |
| `Spool` (Rust) | daemon | `EncryptedSqliteSpool` | `InMemorySpool` |
| `IngestClient` (Rust) | daemon | `MtlsIngestClient` (rustls + client cert) | `LoopbackIngestClient` |
| `KeychainStore` (Rust) | daemon | `MacosKeychainStore`, `SecretServiceStore`, `WinCredStore` | `FileBackedKeychainStore` (0600, dev-only) |
| `BlobStore` | API + evaluator | `S3CompatibleBlobStore` | `LocalFileBlobStore`, `InMemoryBlobStore` |
| `Kms` | API + evaluator | `AwsKmsAdapter`, `GcpKmsAdapter` | `VaultKmsEmulator` (compose), `MockKms` (unit) |
| `TransparencyLog` | API + evaluator | `RekorTransparencyLog` (Sigstore) | `InMemoryMerkleLog`, `RekorMock` HTTP |
| `JudgeLLM` | evaluator | `AnthropicJudgeAdapter`, `OpenAIJudgeAdapter`, `BedrockJudgeAdapter` (pinned triple) | `DeterministicJudge`, `RecordingJudge` (cassettes) |
| `IdentityProvider` | API | `WorkosOidcAdapter` / `Auth0Adapter` (whichever a.team runs) | `LocalOidcAdapter` (Keycloak in compose) |
| `ReceiptStore` | API | `PostgresReceiptStore` (extends existing) | `InMemoryReceiptStore` |
| `ScoreStore` | API + evaluator | `PostgresScoreStore` (RLS-enforced) | `InMemoryScoreStore` |
| `ConsentStore` | API | `PostgresConsentStore` | `InMemoryConsentStore` |
| `AuditSink` | everywhere | `PostgresAppendOnlyAuditSink` + periodic anchor | `InMemoryAuditSink` |
| `GitHubEvents` | evaluator | `GitHubRestAdapter` (OAuth read-only) | `FixtureGitHubAdapter` |
| `Clock` | everywhere | `SystemClock` | `FixedClock(t)` |

### 2.3 Diagram

```
                       ┌─────────────────────  INFRASTRUCTURE  ──────────────────────┐
                       │                                                              │
   ┌──────────────┐    │  ┌──────────┐  ┌────────┐  ┌─────────┐  ┌─────────┐         │
   │ Claude Code/ │    │  │ Postgres │  │ S3 /   │  │  KMS /  │  │ Sigstore│         │
   │ Aider / …    │    │  │  + RLS   │  │ MinIO  │  │ Vault   │  │  Rekor  │         │
   └──┬───────────┘    │  └────┬─────┘  └───┬────┘  └────┬────┘  └────┬────┘         │
      │ OTLP/logs      │       │            │            │            │              │
      ▼                │  ┌────┴────┐ ┌─────┴───┐  ┌─────┴────┐ ┌─────┴────┐         │
   ┌──────────────┐    │  │ Postgres│ │  S3-    │  │  AwsKms  │ │  Rekor-  │         │
   │ CaptureSource│    │  │ Receipt │ │ BlobSt. │  │  Adapter │ │  Adapter │         │
   │ adapter      │    │  │ Store   │ │         │  │          │ │          │         │
   └──┬───────────┘    │  └────┬────┘ └────┬────┘  └────┬─────┘ └────┬─────┘         │
      │                │       │           │            │            │                │
══════╪════════════════╪═══════╪═══════════╪════════════╪════════════╪════════════════
      ▼                ▼       ▼           ▼            ▼            ▼  ports         ▼
      ┌────────────────────────────────────────────────────────────────────────────┐
      │ ┌──────────────────────────────  D O M A I N  ──────────────────────────┐  │
      │ │  Engagement · ConsentGrant · Session · Receipt · Score · Profile       │  │
      │ │  AuditEvent · RubricPin · JudgeTriple                                  │  │
      │ │  Pure services: capture-policy, aggregate, primary-score,              │  │
      │ │                 recency-weighted profile, crypto-shred-decision        │  │
      │ └────────────────────────────────────────────────────────────────────────┘  │
      └────────────────────────────────────────────────────────────────────────────┘
══════╪═══════════════════════════════════════════════════════════════════════════════
      ▲                ▲       ▲           ▲            ▲            ▲  ports         ▲
      │                │  ┌────┴────┐ ┌────┴────┐  ┌────┴─────┐ ┌────┴──────┐         │
   ┌──┴───────────┐    │  │ Postgres│ │ Local-  │  │ Vault-   │ │ InMem-    │         │
   │ Sealer /     │    │  │ Score   │ │ BlobSt. │  │ KmsEmu   │ │ MerkleLog │         │
   │ Redactor /   │    │  │ Store   │ └─────────┘  └──────────┘ └───────────┘         │
   │ Spool / mTLS │    │  └─────────┘                                                  │
   │ IngestClient │    │                                                                │
   └──────────────┘    │   adapters (prod)    │    adapters (test/compose)             │
                       └───────────────────────────────────────────────────────────────┘
```

Trust boundaries (heavy lines crossed by sealed-box ciphertext only):
- builder-laptop ⇄ ingest API   — mTLS + ed25519
- object-store    ⇄ evaluator   — KMS unwrap inside isolated VM

---

## 3. Repo layout

Additive only. No moves of existing code in M4.0.

```
TokenShelf/
├── prisma/
│   └── schema.prisma                      # extend with M4 tables
├── src/
│   ├── app/                                # existing Next.js (unchanged in M4.0)
│   │   ├── globals.css                     # design tokens (new in M4.0)
│   │   └── api/
│   │       ├── (existing routes)
│   │       └── m4/                         # M4 HTTP adapters
│   ├── lib/
│   │   ├── (existing modules unchanged)
│   │   └── m4/
│   │       ├── domain/                     # pure types + invariants
│   │       ├── ports/                      # interface stubs
│   │       ├── adapters/
│   │       │   ├── prod/                   # Postgres, S3, KMS, Rekor, judges, …
│   │       │   └── local/                  # InMemory, LocalFile, MockKms, …
│   │       └── services/                   # composed domain services
│   └── components/m4/                      # builder profile, admin view, consent UI
├── packages/
│   ├── sdk-anthropic/                      # existing
│   └── m4-contracts/                       # port contract tests (cross-adapter)
├── crates/
│   ├── agent-core/                         # Rust domain + ports (lib crate)
│   └── tokenshelf-agent/                   # binary (forked from RTK)
├── features/                               # Gherkin BDD scenarios
│   ├── builder/
│   ├── a_team/
│   ├── buyer/
│   ├── evaluator/
│   └── transparency/
├── docker/
│   ├── m4/
│   │   ├── docker-compose.yml
│   │   ├── .env.docker.example
│   │   └── seed/                           # demo engagement / consent / session
│   └── mocks/                              # rekor-mock, judge-mock, redactor-svc
├── plan/
│   └── M4-a-team-module.md                 # this file
└── pitch/                                  # exec PDF + companion docs (existing)
```

---

## 4. Test strategy

### 4.1 Three layers

| Layer | Runner | Scope | Speed target |
|---|---|---|---|
| **Unit (domain)** | Vitest (TS), `cargo test` (Rust) | Pure functions, no I/O | < 5 s full suite |
| **Port contract** | Vitest + `m4-contracts` suite | Same tests run against every adapter (prod + local) | < 30 s full suite |
| **BDD scenario** | `cucumber-js` (TS), `cucumber-rs` (Rust) | End-to-end flows against `docker compose up` stack | < 5 min full suite |

### 4.2 Unit tests (sample)

`src/lib/m4/domain/__tests__/engagement.test.ts` — must exist before any
`Engagement` constructor is allowed in production code:

```ts
describe("Engagement", () => {
  it("refuses capture without consent", () => {
    const e = makeEngagement({ retentionDays: 30 });
    const ctx = makeSession({ consent: null });
    expect(() => domain.allowCapture(e, ctx)).toThrow(/NO_CONSENT/);
  });
  it("retention cannot drop below 14 days", () => { /* ... */ });
  it("status transition is monotonic", () => { /* ... */ });
});
```

Cover, at minimum, every invariant listed in §2.1.

### 4.3 Port contract tests

`packages/m4-contracts/BlobStore.contract.ts`:

```ts
export const blobStoreContract = (factory: () => BlobStore) => {
  describe("BlobStore contract", () => {
    let store: BlobStore;
    beforeEach(() => { store = factory(); });
    it("put then get round-trips", async () => { /* ... */ });
    it("put is idempotent on same sha", async () => { /* ... */ });
    it("put with different payload same key errors", async () => { /* ... */ });
    it("head returns null for missing", async () => { /* ... */ });
  });
};
```

Each adapter imports the contract and runs it: `blobStoreContract(() =>
new InMemoryBlobStore())`, `blobStoreContract(() => new
S3CompatibleBlobStore(testBucket))`. Same tests, same expectations,
zero adapter-specific assertions.

### 4.4 BDD scenarios

`features/builder/capture.feature`:

```gherkin
Feature: Sealed capture under active consent
  Scenario: Builder opts in, runs a Claude Code session, sealed receipt arrives
    Given an engagement "eng-1" with a published evaluator pubkey
    And builder "alice" has granted ENGAGEMENT-scope consent for "claude_code"
    And the daemon is installed with a valid mTLS cert for "eng-1/alice"
    When "alice" runs a Claude Code session emitting 1234 prompt tokens
    Then a SignedReceipt is uploaded with trustTier "PROXIED_LOCAL"
    And a sealed-box blob is stored under "eng-1/<session>/prompt.bin"
    And the ingest API cannot decrypt the blob
    And the project aggregate increments by 1234 input tokens in the same transaction
```

Full Gherkin file inventory:

```
features/
├── builder/
│   ├── capture.feature              # M4.2 gate
│   ├── consent.feature              # M4.2 gate
│   ├── daemon_install.feature       # M4.1 gate
│   └── appeal.feature               # M4.4 gate
├── a_team/
│   ├── admin_view.feature           # M4.5 gate
│   ├── deep_audit.feature           # M4.4 gate
│   ├── rubric_pin.feature           # M4.3 gate
│   └── evaluator_pubkey_rotation.feature  # M4.4 gate
├── buyer/
│   ├── snapshot_view.feature        # M4.5 gate
│   └── consent_gated_visibility.feature   # M4.5 gate
├── evaluator/
│   ├── pipeline.feature             # M4.4 gate
│   ├── crypto_shred.feature         # M4.4 gate
│   └── judge_triple_drift.feature   # M4.4 gate
└── transparency/
    ├── anchor_cadence.feature       # M4.4 gate
    └── public_verifier.feature      # M4.4 gate
```

A phase gate is "all listed `.feature` files green against `docker
compose up`."

### 4.5 Test-runner setup (M4.0 deliverable)

- TS: `vitest` + `vitest-environment-jsdom` + `@vitest/coverage-v8`.
- Rust: built-in `cargo test` + `cargo-nextest` for parallelism.
- BDD: `@cucumber/cucumber` (TS), `cucumber-rs` for daemon-only
  scenarios.
- CI matrix: macOS-latest, ubuntu-latest, windows-latest (daemon
  binary).

---

## 5. Docker compose stack

`docker/m4/docker-compose.yml` — full local stack with no external
accounts.

| Service | Image | Public port | Volume | Depends on |
|---|---|---|---|---|
| `postgres` | `postgres:16-alpine` | `5432` | `pgdata:/var/lib/postgresql/data` | — |
| `minio` | `minio/minio:RELEASE.2026-02` | `9000` / `9001` | `miniodata:/data` | — |
| `minio-init` | `minio/mc` (one-shot: `mb tokenshelf-blobs`) | — | — | `minio` |
| `vault` | `hashicorp/vault:1.16` (dev, transit) | `8200` | `vaultdata:/vault/file` | — |
| `vault-init` | `hashicorp/vault` (transit setup) | — | — | `vault` |
| `rekor-mock` | `tokenshelf/rekor-mock:dev` (custom Go) | `3000` | — | — |
| `keycloak` | `quay.io/keycloak/keycloak:24` (start-dev) | `8080` | `kcdata:/opt/keycloak/data` | `postgres` |
| `judge-mock` | `tokenshelf/judge-mock:dev` (deterministic) | `4000` | `./fixtures/judge:/fixtures:ro` | — |
| `redactor` | `tokenshelf/redactor:dev` (FastAPI) | `4100` | — | — |
| `app` | `tokenshelf/app:dev` (Next.js + M4 routes) | `3000` | `./:/app` | `postgres`, `minio`, `vault`, `rekor-mock`, `keycloak` |
| `evaluator` | `tokenshelf/evaluator:dev` | internal | — | `postgres`, `minio`, `vault`, `judge-mock`, `redactor`, `rekor-mock` |
| `agent` (dev profile) | `tokenshelf/agent:dev` (Rust) | — | `~/.local/share/tokenshelf-agent:/spool` | `app` |
| `otel-collector` | `otel/opentelemetry-collector-contrib:0.99` | `4317`/`4318` | — | `agent` |

`make compose-up` → boots services → waits for health → runs `pnpm
db:push && pnpm db:seed:m4` → a fresh stack lands with a demo
engagement, builder, consent record, and a sample sealed session blob
already round-tripped.

`.env.docker.example` lists every env var the stack needs
(`DATABASE_URL`, `S3_ENDPOINT`, `KMS_PROVIDER=vault`, `VAULT_TOKEN`,
`REKOR_URL`, `JUDGE_LLM_URL`, `OIDC_ISSUER`, `CRON_SECRET`).

---

## 6. Design tokens

M4.0 first deliverable. Replaces every literal color in components
with CSS custom properties.

`src/app/globals.css`:

```css
:root {
  /* Surface */
  --color-ground:        hsl(222 14% 7%);
  --color-ground-warm:   #fbf8f2;            /* a.team paper theme */
  --color-surface:       hsl(222 14% 10%);
  --color-surface-2:     hsl(222 14% 13%);

  /* Ink */
  --color-ink:           hsl(210 20% 96%);
  --color-ink-soft:      hsl(210 20% 80%);
  --color-ink-warm:      #1a1813;
  --color-ink-warm-soft: #3d3a32;
  --color-mute:          hsl(217 10% 64%);
  --color-faint:         hsl(217 10% 40%);

  /* Lines */
  --color-rule:          hsl(222 14% 18%);
  --color-rule-soft:     #ebe6dc;

  /* Brand + accents */
  --color-brand:         hsl(142 71% 50%);   /* TokenShelf marketplace */
  --color-accent:        #c9690a;            /* a.team partner accent */
  --color-accent-deep:   #9c4d05;
  --color-accent-warm:   #f4e4c8;
  --color-accent-pale:   #fbf2e0;
  --color-token:         hsl(36 100% 60%);

  /* Trust tiers */
  --color-trust-verified: hsl(142 71% 50%);
  --color-trust-proxied:  hsl(36 100% 60%);
  --color-trust-self:     hsl(0 0% 60%);

  /* Score signals */
  --color-score-good:    hsl(142 71% 45%);
  --color-score-warn:    hsl(36 100% 55%);
  --color-score-bad:     hsl(0 70% 55%);
  --color-outlier:       hsl(280 60% 60%);

  /* Status */
  --color-success:       hsl(142 71% 45%);
  --color-warning:       hsl(36 100% 55%);
  --color-danger:        hsl(0 70% 55%);
  --color-info:          hsl(210 80% 60%);

  /* Consent state */
  --color-consent-active:  var(--color-success);
  --color-consent-revoked: var(--color-danger);
  --color-consent-pending: var(--color-warning);

  /* Focus + selection */
  --color-focus-ring:    hsl(142 71% 50% / .6);
  --color-selection:     hsl(142 71% 50% / .35);

  /* Radii + spacing */
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 16px;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-6: 24px; --space-8: 32px;

  --shadow-card: 0 1px 0 hsl(222 14% 18%), 0 10px 30px rgba(0,0,0,.35);
}

[data-theme="paper"] {       /* a.team buyer-snapshot view */
  --color-ground:    var(--color-ground-warm);
  --color-ink:       var(--color-ink-warm);
  --color-ink-soft:  var(--color-ink-warm-soft);
  --color-surface:   rgba(255,255,255,.55);
  --color-rule:      var(--color-rule-soft);
}
```

`tailwind.config.ts` rebinds: every existing color (`bg`, `surface`,
`brand`, `token`, `border`, `text`, `muted`) becomes
`var(--color-…)`.

**Enforcement.** `eslint-plugin-no-color-literals` configured in
`.eslintrc` to flag any `#hex`, `rgb()`, or `hsl()` outside
`globals.css` or the static pitch HTML. PR check blocks the merge if a
new literal appears.

---

## 7. Phase-by-phase tickets

### M4.0 — Foundation

1. **Test runner.** Install Vitest + Cucumber.js. Wire `pnpm test`,
   `pnpm test:contract`, `pnpm test:bdd`. Add a placeholder failing
   test so the runner runs.
2. **Hexagonal scaffolding.** Create `src/lib/m4/{domain,ports,
   adapters/{prod,local},services}/`. Add `eslint-plugin-import` rule
   forbidding `domain/` → adapter imports.
3. **Rust workspace.** Add `crates/agent-core` (lib) and stub
   `crates/tokenshelf-agent` (bin). Both build under `cargo workspace`.
4. **`docker-compose.yml`.** Minimum services: postgres, minio,
   vault, app. Verify `pnpm db:push` and the dev server boot under
   compose.
5. **Design tokens.** Move every literal color in
   `src/app/globals.css` and `tailwind.config.ts` to the variable
   palette in §6. Add `eslint-plugin-no-color-literals` with allowlist
   for `globals.css` only. Verify existing pages render unchanged.
6. **CI matrix.** GitHub Actions: TS on ubuntu, Rust on macOS / ubuntu
   / windows. Add `cargo-deny`, `cargo-audit`. Add SBOM emission
   (CycloneDX).

**Gate to M4.1:** `pnpm test` green; `docker compose up` boots; lint
blocks new color literals; CI green on all OS targets.

### M4.1 — Daemon skeleton

1. **Fork hygiene.** Fork `rtk-ai/rtk@develop` →
   `a-team/tokenshelf-agent`. Rename crate to `tokenshelf-agent`.
   Resolve the upstream MIT/Apache license mismatch (file an issue
   first). Add NOTICE crediting Patrick Szymkowiak. Drop `rtk` as a
   binary name. Wire `cargo-deny` + `cosign` keyless signing + GitHub
   artifact attestations into `release.yml`.
2. **Workspace integration.** Move forked crate into
   `crates/tokenshelf-agent`. Add `crates/agent-core` dependency.
   Verify cross-platform CI matrix still green.
3. **Port seam.** Add `crates/agent-core/src/ports/receipt_sink.rs`
   trait. Two adapters: `SqliteSink` (current RTK behavior) and stub
   `TokenshelfSink` (no-op for now). Inject at two seams:
   `core/runner.rs` post-exec, `analytics/ccusage.rs` poll-loop. Zero
   behavior change.
4. **Upstream merge cron.** GitHub Action that opens a PR from RTK
   develop to our `main` weekly. Resolve conflicts manually.
5. **Filter upstream contributions.** Pick 1-2 useful TOML filters
   from our usage and submit upstream — establishes good-faith
   relationship.

**Gate to M4.2:** Daemon builds on all 3 OSes; CI signs binaries with
Sigstore; upstream merge cron lands its first PR; port seam in place;
existing RTK behavior preserved (sqlite tracking still works).

### M4.2 — Sealed ingest path

1. **`Sealer` adapter.** `LibsodiumSealer` in
   `crates/agent-core/src/adapters/`. Contract tests against
   `XorSealer` mock.
2. **`Spool` adapter.** `EncryptedSqliteSpool` with key sealed to OS
   keychain. Backpressure cap (default 1 GiB).
3. **`IngestClient`.** `MtlsIngestClient` (rustls). Client cert minted
   at `tokenshelf-agent install --engagement <id>`. Pinned at
   transparency-log entry.
4. **`KeychainStore`.** Platform-specific adapters
   (Keychain/libsecret/Credential Manager) + `FileBackedKeychainStore`
   for dev.
5. **Consent state.** SQLite table in the daemon plus
   `tokenshelf-agent consent grant|revoke|status` subcommands.
6. **Server-side ingest endpoint.** `POST /api/m4/ingest` accepts
   sealed-box ciphertext + signed receipt + mTLS client cert. Stores
   ciphertext in `BlobStore` (S3CompatibleBlobStore in prod,
   LocalFileBlobStore in compose). Updates `Receipt` row with
   `trustTier=PROXIED_LOCAL`. Updates project aggregates in same
   transaction.
7. **Per-engagement KEK lifecycle.** `Kms.generateDek` /
   `unwrapDek` / `destroyKek`. KMS adapter wraps DEK under engagement
   KEK.
8. **BDD: `features/builder/capture.feature`,
   `features/builder/consent.feature`.**

**Gate to M4.3:** Builder can install daemon, opt in, run a Claude Code
session, and verify a sealed receipt arrived; ingest API cannot
decrypt; consent revocation halts capture within 60 seconds.

### M4.3 — Objective scoring

1. **Schema additions.** `engagement`, `session`, `consent`, `score`
   tables. Migration. RLS policies.
2. **Primary score computation.** Pure functions in
   `src/lib/m4/services/primary-score.ts`. Inputs:
   `Receipt[]`, `GitHubEvent[]`, `CiRun[]`, `RubricPin`. Output:
   `Score`.
3. **Recency-weighted profile.** Pure function. `BuilderProfile` read
   model.
4. **Rubric repo seed.** New OSS repo `a-team/tokenshelf-rubric` with
   `rubric/v1.json` (weights, normalization, judge prompt template).
   First version committed in TS as a static JSON; later loaded from
   the public repo by hash.
5. **Builder private dashboard.** `/u/[handle]/m4/dashboard` page —
   shows builder's own scores. Always visible to the builder; never
   public unless opt-in flag set.
6. **GitHubEvents adapter.** `GitHubRestAdapter` against the builder's
   read-only OAuth scope.
7. **BDD: `features/a_team/rubric_pin.feature`.**

**Gate to M4.4:** Builder views their own score; score reproducible
from inputs (replay test passes); rubric version pinned per
engagement.

### M4.4 — Evaluator pipeline

1. **Evaluator service.** Composed from ports: `BlobStore + Kms +
   Redactor + JudgeLLM + ScoreStore + AuditSink + GitHubEvents +
   TransparencyLog`. Triggered by `Receipt` insert.
2. **Sandbox.** Production: Firecracker microVM; dev: container. No
   internet egress except allow-listed LLM endpoint.
3. **Redactor.** Open-source rule set in `packages/m4-contracts/
   redactor-rules.toml` (regex). NER pass via a sidecar in compose.
4. **Judge sanity layer.** `AnthropicJudgeAdapter`,
   `OpenAIJudgeAdapter`, `BedrockJudgeAdapter`. Inter-rater pairs
   sampled at 30% during first quarter of engagement, tapering to 10%.
5. **Held-out calibration set.** Weekly cron re-judges N=50 historical
   fixtures to detect absolute drift.
6. **Transparency log.** `RekorTransparencyLog` anchors hourly. Audit
   chain hash anchored at same cadence.
7. **Crypto-shred.** Cron at engagement end + retention window:
   `Kms.destroyKek`. Audit event + transparency anchor.
8. **BDD:
   `features/evaluator/pipeline.feature`,
   `features/evaluator/crypto_shred.feature`,
   `features/evaluator/judge_triple_drift.feature`,
   `features/a_team/deep_audit.feature`,
   `features/a_team/evaluator_pubkey_rotation.feature`,
   `features/transparency/anchor_cadence.feature`,
   `features/transparency/public_verifier.feature`,
   `features/builder/appeal.feature`.**

**Gate to M4.5:** Evaluator runs in isolated VM with no egress;
crypto-shred at retention end deletes KEK and the audit/transparency
events are publicly verifiable.

### M4.5 — UI surfaces

1. **Builder public profile.** `/p/[handle]` — opt-in only. Renders
   `BuilderProfile` read model + score history chart. Uses `paper`
   theme.
2. **a.team admin view.** `/m4/a-team/engagements/[id]` — engagement
   intelligence, account-manager dashboard. Behind a.team org SSO.
3. **Buyer-facing snapshot.** `/m4/buyer/[engagement]/snapshot` —
   aggregate score + cryptographic receipt links. Opt-in by builder
   per engagement.
4. **Consent UI.** Builder-facing flow in
   `/u/[handle]/m4/consent` — engagement-scope vs session-scope vs
   revoke; visibility toggles per consumer (a.team / buyer / public).
5. **Components.** `EngagementScore.tsx`, `ConsentToggle.tsx`,
   `SessionIndicator.tsx`, `TrustBadgeM4.tsx` (extends existing). All
   styled exclusively via design tokens.
6. **BDD:
   `features/buyer/snapshot_view.feature`,
   `features/buyer/consent_gated_visibility.feature`,
   `features/a_team/admin_view.feature`.**

**Gate to M4.6:** All UI flows tested with BDD; visual parity with
pitch page 2; design-token lint clean.

### M4.6 — Production hardening

1. **KMS rotation runbook.** Quarterly key rotation with no
   re-encryption of existing blobs; new sessions use new KEK.
2. **SLSA L3.** Hermetic builds (self-hosted runner pool). Provenance
   attestation per release.
3. **Source escrow.** Filed with a third-party escrow vendor. Named
   technical successor disclosed at contract signing (separate doc).
4. **SOC 2 scoping.** Document the in-scope systems with a.team's
   compliance team.
5. **Pen test.** External red-team report against deployed sanity-
   layer judge (≥ 100 adversarial sessions) + against daemon
   supply-chain (see security companion §4.1).
6. **Jurisdiction memo.** Signed by named outside counsel: EU AI Act,
   France/Germany works-council, NYC LL 144, GDPR, Canada Law 25,
   California CPRA. Attached to first-customer engagement contract.

**Gate to launch:** External pen-test report's blocking findings
remediated; legal memo + escrow filing complete.

---

## 8. Schema changes

Additions to `prisma/schema.prisma`. All keep the existing TokenShelf
invariants (CLAUDE.md rules #3 and #4: idempotent sync, aggregates +
receipts in same transaction).

```prisma
model Engagement {
  id                String   @id @default(cuid())
  orgId             String   // a.team tenant
  rubricVersion     String
  evaluatorPubKey   Bytes
  retentionDays     Int      @default(90)
  status            EngagementStatus @default(ACTIVE)
  createdAt         DateTime @default(now())
  endedAt           DateTime?
  consents          Consent[]
  sessions          Session[]
  scores            Score[]
}

enum EngagementStatus { ACTIVE WOUND_DOWN }

model Consent {
  id                  String   @id @default(cuid())
  engagementId        String
  builderId           String
  scope               ConsentScope
  sessionId           String?
  capture             Json     // { tools: string[]; promptBodies: boolean }
  publicProfileOptIn  Boolean  @default(false)
  grantedAt           DateTime @default(now())
  revokedAt           DateTime?
  engagement          Engagement @relation(fields: [engagementId], references: [id])
  builder             User       @relation(fields: [builderId], references: [id])
  @@index([engagementId, builderId, scope])
}

enum ConsentScope { ENGAGEMENT SESSION }

model Session {
  id                String   @id @default(cuid())
  engagementId      String
  builderId         String
  tool              String
  daemonVersion     String
  daemonAttestation String   // sigstore bundle ref
  startedAt         DateTime
  endedAt           DateTime?
  promptBytes       Int      @default(0)
  diffBytes         Int      @default(0)
  blobUri           String?
  envelopePubkeyHash String?
  receipts          TokenReceipt[]
  engagement        Engagement @relation(fields: [engagementId], references: [id])
  builder           User       @relation(fields: [builderId], references: [id])
  @@index([engagementId, builderId])
  @@index([startedAt])
}

model Score {
  id            String   @id @default(cuid())
  engagementId  String
  builderId     String
  prUrl         String
  rubricVersion String
  components    Json     // [{ name, raw, normalized, weight }]
  composite     Float
  sanityFlag    SanityFlag?
  judgeTriple   Json     // [JudgeRef, JudgeRef, JudgeRef]
  computedAt    DateTime @default(now())
  anchoredAt    DateTime?
  anchorRoot    String?
  engagement    Engagement @relation(fields: [engagementId], references: [id])
  builder       User       @relation(fields: [builderId], references: [id])
  @@unique([engagementId, builderId, prUrl, computedAt])
  @@index([builderId, computedAt])
}

enum SanityFlag { OUTLIER NORMAL }
```

`TokenReceipt` extends with optional `sessionId String?` and an
additional `PROXIED_LOCAL` value in the `TrustTier` enum. The
idempotency key composition stays the same; sessions are a
denormalization on top.

`AuditEvent` extends with hash-chaining fields:
`prevHash String?`, `eventHash String`, `anchoredInTLogRef String?`.

---

## 9. Open-source posture

Open-source repos under `github.com/a-team/`:
- `tokenshelf-agent` — daemon (fork of RTK).
- `tokenshelf-rubric` — scoring rubric, judge prompt templates,
  aggregation formula.
- `tokenshelf-redactor` — PII rule set.
- `tokenshelf-verifier` — third-party receipt + transparency-log
  verifier CLI.

Closed under commercial license (escrow filed):
- `tokenshelf-api` — ingest + storage + admin/buyer views.

---

## 10. Parallel work tracks (sub-agent candidates)

The phases sequence sequentially, but within each phase several tracks
can run independently. Use sub-agents (per CLAUDE.md global guideline)
where the work has no cross-coupling.

| Phase | Track | Owner | Parallel with |
|---|---|---|---|
| M4.0 | Vitest + Cucumber.js setup | TS lead | Rust workspace stub |
| M4.0 | Rust workspace stub | Rust lead | TS test setup |
| M4.0 | docker-compose minimum | DX lead | Design-token migration |
| M4.0 | Design-token migration | UI lead | docker-compose |
| M4.1 | Fork hygiene + Sigstore | Rust lead | TokenshelfSink stub |
| M4.1 | Filter contributions upstream | Rust lead | Sigstore wiring |
| M4.2 | Sealer + Spool + Keychain | Rust lead | Server ingest endpoint |
| M4.2 | Server ingest endpoint | TS lead | Daemon adapters |
| M4.3 | Primary-score pure functions | TS lead | Rubric repo seed |
| M4.3 | Rubric repo seed | TS lead | Builder dashboard |
| M4.4 | Evaluator service | TS / Rust | Redactor sidecar |
| M4.4 | Transparency-log integration | TS lead | Crypto-shred cron |
| M4.5 | Builder profile | UI lead | a.team admin view |
| M4.5 | a.team admin view | UI lead | Buyer snapshot |
| M4.5 | Buyer snapshot | UI lead | Consent UI |

For sub-agent dispatch, scope each track tightly: one PR target, one
port or one route, with the contract tests/Gherkin scenarios named in
the brief.

---

## 11. Open decisions

These need a.team's input before M4.2:

1. **Identity provider.** Auth0 vs Workos vs Entra ID (Azure AD) —
   whichever a.team already runs. Affects `IdentityProvider` adapter.
2. **Judge LLM provider zero-retention contract.** Azure OpenAI (same
   tenant, lowest latency from Canada Central) and/or Anthropic?
3. **a.team token mechanism for beta cohort.** Existence and shape are
   a.team's call (per pitch). Affects whether `BuilderProfile`
   includes a beta-status field.
4. **Rubric v1 weights.** Default proposal in §7 (M4.3) is
   placeholder; first 30 calibration sessions inform real weights.
5. **GitHub OAuth scope strategy.** Per-builder personal OAuth vs
   a.team GitHub App. Affects `GitHubEvents` adapter wiring.

**Resolved decisions:**

- **Cloud substrate: Azure, Canada Central (Toronto).** Data residency
  stays Canadian. Bicep IaC in [`infra/azure/`](../infra/azure/) maps
  each port from §2 to a concrete Azure service (see §13 below).

---

## 12. Verification (what "M4 done" looks like)

- All Gherkin features under `features/` are green against
  `docker compose up`.
- `pnpm test` (unit) and `pnpm test:contract` (port contracts) are
  green on CI's full matrix.
- `cargo test` green on macOS, Linux, Windows.
- `docker compose up` from a clean checkout boots the full stack,
  seeds demo data, and `pnpm db:seed:m4` lands a round-tripped sealed
  session blob.
- A builder can install the daemon, opt in to an engagement, run a
  Claude Code session, and view their own score; only after explicit
  opt-in does that score appear on their `/p/[handle]` profile.
- a.team admins can deep-audit a session under the two-person rule;
  the builder receives a notification within 60 minutes; the read is
  anchored in the transparency log.
- Buyer snapshot view, under double consent, renders aggregate scores
  + cryptographic verifier links.
- Crypto-shred at retention end deletes the KEK; subsequent reads
  return `KEK_DESTROYED`; the event is anchored publicly.
- External pen-test report on the deployed judge has zero
  unmitigated S0 findings.
- Privacy counsel memo + source escrow filed; first a.team-customer
  contract signed.

---

## 13. Azure Canada Central — port-to-adapter map

Substrate locked in. Bicep IaC under [`infra/azure/`](../infra/azure/);
deployment runbook in [`infra/azure/README.md`](../infra/azure/README.md).
Hexagonal contract is preserved — domain remains framework-agnostic;
only adapters are Azure-specific.

| Port (§2.2)         | Production adapter (`src/lib/m4/adapters/azure/`) | Azure resource |
|---|---|---|
| `BlobStore`          | `AzureBlobStoreAdapter`        | Storage Account · `sealed-sessions` / `project-assets` / `audit-anchors` containers |
| `Kms`                | `AzureKeyVaultKmsAdapter`      | Key Vault Premium (HSM-backed in prod, Standard in stg) |
| `ReceiptStore`       | `PostgresReceiptStore`         | Database for PostgreSQL Flexible Server (VNet-injected) |
| `ConsentStore`       | `PostgresConsentStore`         | same Postgres |
| `ScoreStore`         | `PostgresScoreStore`           | same Postgres, RLS-enforced |
| Sessions / events    | `CosmosSessionStore`           | Cosmos DB SQL API serverless · `sessions` container, partitioned on `/engagementId` |
| `TransparencyLog`    | `CosmosTransparencyAdapter` + `RekorOSSAdapter` (Rekor self-hosted on Container Apps) | Cosmos `transparency-entries` + self-hosted Rekor sidecar |
| Judge traces         | `CosmosJudgeTraceStore`        | Cosmos `judge-traces` (90-day TTL) |
| `JudgeLLM`           | `AzureOpenAIJudgeAdapter` + `AnthropicJudgeAdapter` | Azure OpenAI in Canada Central + Anthropic via API |
| `IdentityProvider`   | `EntraIdAdapter` (federated)   | Microsoft Entra ID (formerly Azure AD) |
| Compute · web        | n/a (deployment target)        | Azure Container Apps (Consumption profile) |
| Compute · evaluator  | n/a                            | Azure Container Apps **Jobs** (will move to Confidential Containers when GA in Canada) |
| Container images     | n/a                            | Azure Container Registry (Premium in prod, Basic in stg) |
| Observability        | wired via `APPLICATIONINSIGHTS_CONNECTION_STRING` | Log Analytics + Application Insights |
| Secrets distribution | Managed Identity → Key Vault references | Container Apps + user-assigned MI |
| Network isolation    | VNet with delegated subnets    | one VNet, two subnets (app delegated, data delegated to Postgres + service endpoints for KV/Storage/Cosmos) |

**Adapter directory layout** (post-M4.0):

```
src/lib/m4/adapters/
├── prod/azure/
│   ├── blob-store.ts         # @azure/storage-blob + DefaultAzureCredential
│   ├── key-vault-kms.ts      # @azure/keyvault-keys + @azure/keyvault-secrets
│   ├── cosmos-session.ts     # @azure/cosmos
│   ├── entra-id.ts           # @azure/identity + MSAL
│   ├── postgres-receipt.ts   # pg + existing schema
│   └── azure-openai-judge.ts # @azure/openai
├── local/                    # InMemory*, LocalFile*, MockKms, KmsEmulator-Vault, …
└── README.md                 # which env wires which
```

**Bicep file tree:**

```
infra/azure/
├── main.bicep                          # subscription scope, deploys RG + all modules
├── main.parameters.dev.json
├── main.parameters.stg.json            # references KV-bootstrap secret
└── modules/
    ├── network.bicep                   # VNet + 2 subnets + Postgres private DNS
    ├── identity.bicep                  # 2 user-assigned MIs (app + evaluator)
    ├── observability.bicep             # Log Analytics + App Insights
    ├── keyvault.bicep                  # Premium KV + RBAC role assignments
    ├── storage.bicep                   # Blob account + 3 containers + role assignments
    ├── cosmos.bicep                    # NoSQL serverless + 3 containers + data-plane RBAC
    ├── postgres.bicep                  # Flexible Server (VNet-injected) + diag settings
    ├── registry.bicep                  # ACR (Premium in prod, Basic elsewhere)
    └── containerapp.bicep              # Managed environment + web app (managed-identity ACR pull)
```

**Cost envelope** (estimated, monthly USD, stg sizing):
~$55-80 idle/light traffic — Postgres Burstable + Cosmos serverless +
Storage LRS + Standard KV + Basic ACR + Container Apps Consumption. See
[`infra/azure/README.md`](../infra/azure/README.md) for prod sizing
(~$400-600 before traffic).

**What the Bicep does NOT yet provision:**

- Confidential Container runtime for the M4.4 evaluator sandbox.
  Container Apps Jobs is the M4.4 starting point; we'll move the
  evaluator workload to Confidential Containers when GA in Canada
  Central. The hexagonal port stays the same; only the adapter spec
  changes.
- Front Door / WAF. Add in M4.6 production hardening.
- Private endpoints on Cosmos / Storage / KV / ACR. Templates have
  `publicNetworkAccess: 'Disabled'` wired in for prod env; PE
  resources need to be added before the prod deployment.
- Confidential VM SKUs / Azure attestation. Pre-pen-test deliverable.

---

## 14. Out of scope for M4

- Multi-tenancy across non-a.team marketplaces (Toptal, Andela, etc.).
  TokenShelf core remains marketplace-agnostic; the a.team module is
  one instantiation.
- Live Stripe billing (existing in TokenShelf as stub).
- Mobile clients.
- Builder-side desktop GUI (only CLI + status notifications in M4).
- Real-time score updates (M4 scores compute on PR-merge, not
  per-keystroke).
