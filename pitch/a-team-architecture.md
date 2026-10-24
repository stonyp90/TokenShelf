# TokenShelf for a.team — Architecture brief

**Companion to** [`a-team.pdf`](./a-team.pdf). For a.team engineering and
product. ~6 pages. Updated post-internal-review (May 2026).

This document specifies the system architecture in enough detail that
a.team's engineering team can validate feasibility, identify integration
surfaces, and red-team the design. The pitch makes the case; this
document defends it.

The architecture is deliberately **substrate-agnostic** — no specific
cloud provider, container runtime, KMS vendor, or transparency-log
implementation is required. Where the pitch names a class of component
(HSM-backed KMS, hardware-isolated sandbox, append-only transparency
log), the architecture brief enumerates the requirements that any
implementation must meet.

---

## 1. Design rules

These are non-negotiable. The whole system shape follows from them.

1. **Objective signals are the primary score.** The number that affects
   an engagement (renewal, account-manager attention, buyer-facing
   surface) is computed by pure functions over receipts, GitHub events,
   and CI signals. Reproducible. Explainable. Survives a deposition.
2. **No opaque ML in the primary loop.** Inherited from the existing
   TokenShelf design rule in `CLAUDE.md`. The LLM sanity layer is a
   *separate* layer with its own published rubric and audit trail — it
   does not feed the primary score, only flags outliers and supports
   builder appeals.
3. **Per-engagement consent gates everything.** Daemon refuses to run
   without an active engagement context. Provider API keys never leave
   the builder's OS keychain.
4. **Prompts and diffs are stored encrypted with sealed-content
   envelopes.** The ingest API cannot decrypt; only the evaluator
   sandbox, holding the recipient private key inside a.team's
   HSM-backed KMS, can.
5. **Capture mechanisms must be defensible.** No universal MITM
   proxy. No local root CA installed in builders' trust stores. Each
   AI tool is captured through its supported extensibility surface or
   it is explicitly out of scope and labelled as such.
6. **Open daemon. Open rubric. Open redactor. Open verifier.** Closed
   server, with source escrow.

---

## 2. Component map

```
┌──────────────────────────  builder laptop  ──────────────────────────┐
│                                                                       │
│   ┌─────────────────┐                                                 │
│   │ AI coding tool  │  per-tool capture (see §4)                      │
│   │   (Claude Code, │       │                                         │
│   │    Cursor,      │       ▼                                         │
│   │    Aider, …)    │  ┌──────────────────┐                           │
│   └─────────────────┘  │ tokenshelf-agent │  (Rust, Apache-2.0)       │
│           │            │ • per-tool hook  │                           │
│           │            │ • PII redactor   │  spool: encrypted SQLite  │
│           │            │ • sealed-box     │  keys: OS keychain        │
│           │            │ • spool + retry  │                           │
│           │            └──────────┬───────┘                           │
│           │ direct calls          │ mTLS, ed25519-signed receipts     │
│           │ (provider key in      │                                   │
│           │  OS keychain only)    │                                   │
└───────────┼───────────────────────┼───────────────────────────────────┘
            ▼                       ▼
   ┌─────────────────┐    ┌──────────────────────────────────────────┐
   │ AI provider     │    │ a.team-operated infrastructure           │
   │ (Anthropic,     │    │                                          │
   │  OpenAI, …)     │    │   ┌────────────────────────────┐         │
   └─────────────────┘    │   │ ingest API (closed source) │         │
                          │   │ stores ciphertext only     │         │
                          │   └────────────┬───────────────┘         │
                          │                ▼                          │
                          │   ┌─────────────────────┐                 │
                          │   │ relational store    │                 │
                          │   │ receipts + scores   │                 │
                          │   │ row-level policies  │                 │
                          │   └─────────────────────┘                 │
                          │                │                          │
                          │   ┌─────────────────────┐                 │
                          │   │ object store        │                 │
                          │   │ encrypted blobs     │                 │
                          │   │ KMS-wrapped DEKs    │                 │
                          │   └────────────┬────────┘                 │
                          │                ▼                          │
                          │   ┌─────────────────────┐                 │
                          │   │ evaluator sandbox   │                 │
                          │   │ • hardware-isolated │   ┌───────────┐ │
                          │   │ • no egress except  │──▶│ judge LLM │ │
                          │   │   pinned LLM        │   └───────────┘ │
                          │   │ • decrypt in memory │                 │
                          │   │ • destroyed after   │                 │
                          │   └────────────┬────────┘                 │
                          │                ▼                          │
                          │   ┌─────────────────────┐                 │
                          │   │ score store + audit │                 │
                          │   │ append-only log     │                 │
                          │   └─────────────────────┘                 │
                          │                                          │
                          │   ┌─────────────────────┐                 │
                          │   │ append-only public  │ (Sigstore-      │
                          │   │ transparency log    │  compatible)    │
                          │   └─────────────────────┘                 │
                          └──────────────────────────────────────────┘
```

The two trust boundaries that matter most:

- **Builder ↔ ingest API.** mTLS with per-engagement client certificate;
  ed25519 signed receipts at the application layer for defense in depth.
- **Object store ↔ evaluator.** Blob ciphertext is opaque to the ingest
  API. The evaluator sandbox is the *only* place ciphertext is
  decrypted, and only in memory, and only for the duration of one
  evaluation.

---

## 3. Substrate requirements (cloud-agnostic)

a.team selects implementations from any cloud or on-prem stack that
meets the following requirements.

| Component | Requirement | Acceptable implementations |
|---|---|---|
| Relational store | RLS / row-level access policies, encrypted at rest, regional residency control | Postgres, Aurora, Cloud SQL, on-prem RDBMS with RLS extension |
| Object store | Per-object encryption, lifecycle policies, audit logs of reads | S3, GCS, R2, Azure Blob, on-prem MinIO with KMS integration |
| KMS / HSM | HSM-backed, audit log on key use, scheduled destruction with rollback window | AWS KMS, GCP KMS, Azure Key Vault HSM, on-prem nShield / CloudHSM |
| Evaluator sandbox | Hardware isolation, no internet egress except allow-listed endpoint, fresh-per-eval | Firecracker, Kata, gVisor, AWS Nitro Enclaves, on-prem KVM |
| Transparency log | Append-only, publicly verifiable, supports keyless or third-party-keyed signing | Sigstore Rekor, Trillian, on-prem Merkle-tree log with public mirror |
| Identity | OIDC, mTLS client-cert minting, per-engagement scoping | Auth0, Workos, Okta, Keycloak, the IdP a.team already operates |

Crypto primitives are **not** substrate-agnostic. The pitch and brief
name them explicitly because protocol-level decisions are part of the
trust statement.

| Primitive | Choice | Rationale |
|---|---|---|
| Receipt signing | ed25519 | Compact signatures, public verifier-friendly, no curve negotiation |
| Sealed-content envelope | libsodium sealed-box (X25519 + XSalsa20-Poly1305) | Asymmetric write, symmetric read; one-shot use; no key-agreement needed |
| At-rest encryption | AES-256-GCM | Standard, hardware-accelerated, AEAD |
| Receipt ID | BLAKE3 | Fast, suitable for idempotency keys |
| Builder authentication | mTLS with engagement-scoped client cert | Defense in depth atop the application-layer signature |

---

## 4. Capture mechanisms

The biggest design shift versus the original draft: **no universal MITM
proxy.** Each AI tool is captured through its supported extensibility
surface. Coverage is partial by design — what we capture, we verify;
what we don't capture, we label as `SELF_REPORTED` or omit from
scoring entirely.

### 4.1 Per-tool capture

| Tool | Mechanism | Notes |
|---|---|---|
| Claude Code | OpenTelemetry export | Claude Code emits OTel traces with prompt + token usage. Daemon runs a local OTLP collector and ingests. No MITM. Builders configure via Claude Code's existing env-var convention. |
| Aider | Structured log mode (`--log`) | Aider writes session JSON. Daemon tails the log directory. Per-engagement log directory pinned at install. |
| Cursor | Enterprise admin API + BYOK fallback | Where a.team's customers have Cursor Enterprise, the admin API gives authoritative per-user usage. For BYOK personal-tier Cursor, daemon captures via Anthropic/OpenAI provider Admin API readout (lossy but signed). |
| Codex CLI | Process wrapper mode | `tokenshelf-agent run codex …` wraps the subprocess and captures stdin/stdout. No MITM; only environment isolation. |
| Provider APIs direct | Provider Admin API sync (already shipped) | Anthropic + OpenAI Admin APIs return authoritative per-key usage with `request_id`. This is the `VERIFIED` trust tier and the backstop for all other captures. |
| GitHub Copilot | **Out of scope** | No public per-user usage API as of May 2026. The pitch is honest about this. If a.team partners with GitHub for the Copilot Business admin API, integration is straightforward; until then, Copilot-heavy builders are not captured. |

### 4.2 Why this is better than universal MITM

The original draft proposed a local TLS-terminating proxy that would
install a root CA in the builder's trust store and intercept all AI
tool traffic. The security review (see `a-team-security.md`) identified
this as the single highest-risk design choice in the system:

- A local root CA is functionally equivalent to commodity infostealer
  malware from a forensic-tool perspective.
- MDM-managed builder machines (the ones working on Fortune 500
  engagements — exactly a.team's buyer base) cannot install root CAs
  without IT approval.
- The CA private key on the builder's machine becomes the new crown
  jewel. Same-user processes can read it.
- Apple notarization revocation history (Zoom 2019) makes the
  code-signing dependency operationally fragile.

Per-tool capture trades coverage for trust. The pitch is explicit
about that trade.

### 4.3 Diff attribution at PR level, not session level

The original draft attributed the working-tree diff at session close to
the AI calls in that session. The architecture review identified this
as too noisy: builders interleave AI calls with manual edits, IDE
refactors, branch switches, and `git stash` operations.

The current design attributes **at the PR level**. All AI-tool sessions
within a PR's lifetime are aggregated; the eventual merged diff is the
contribution attributed to that aggregate. Score components that need
finer granularity (cycle-time, retry-to-green) operate at the
session/CI-event level, but the *contribution diff* is PR-scoped.

This loses some granularity. It gains defensibility — every score
maps to a specific GitHub PR URL that a buyer or builder can inspect.

---

## 5. Scoring rubric (objective-first)

### 5.1 Primary score: pure functions over signals

Per builder, per engagement, computed continuously. All inputs from
TokenShelf receipts or builder-authorized GitHub OAuth scope.

| Metric | Source | Direction |
|---|---|---|
| Tokens per merged PR | TokenShelf receipts + GitHub merge events | Lower is better |
| Retry-to-green-tests ratio | CI events on builder-authored PRs | Lower is better |
| Cycle time: first prompt → merged commit | Receipt timestamps + GitHub | Lower is better |
| Revert-within-14-days rate | GitHub revert events | Lower is better |
| PR-review-comment density on AI-touched files | GitHub review API | Inverse U: very high or very low both flag |
| Cost per merged PR (USD) | Receipt cost × tokens | Lower is better |

Each metric is normalized against a peer-group baseline (similar
engagement tag, similar repo language stack). The primary score is a
weighted sum with weights published in the open `tokenshelf-rubric`
repository and pinned per engagement.

Aggregation across engagements for a builder profile is
recency-weighted, with explicit decay parameters in the published
rubric.

### 5.2 Sanity layer: LLM judge as outlier flag

The LLM sanity layer runs in a separate hardware-isolated sandbox per
session. It produces:

- **Outlier flag** — does this session look anomalous against the
  builder's own baseline or against peers on the same engagement?
- **Qualitative summary** — used only when a builder or a.team account
  manager appeals or requests context.
- **Calibration delta** — for the 10–30% sampling rate (higher early in
  an engagement, tapering), a second pinned judge model runs in
  parallel for inter-rater agreement tracking.

The sanity layer **never produces a number that drives engagement
renewal**. It is advisory to a.team account managers and the qualitative
voice on appeal.

### 5.3 Model retirement

LLM providers deprecate models on ~12-month cycles. The rubric
versioning explicitly handles this:

- Each engagement pins a **rubric version** (e.g., `rubric/v1.json`)
  and a **judge calibration triple** — three model+version pairs that
  produce comparable outputs. Pinning a triple instead of a single
  model means one provider's retirement does not invalidate the
  engagement's scores.
- A small held-out **historical calibration set** of human-rated
  sessions is re-judged weekly to detect absolute drift in addition to
  the inter-rater relative drift signal.
- Scores are tagged with the rubric version and judge triple actually
  used; this metadata survives model retirement.

---

## 6. Transport and ingest

- **Authentication.** Per-engagement mTLS client certificate, minted at
  daemon install. The cert encodes `(engagement_id, builder_id,
  machine_fingerprint)`. The ingest API rejects any mismatch.
- **Application-layer signature.** Each receipt payload signed with
  ed25519. The verifier endpoint at
  `/.well-known/tokenshelf-verify.json` exposes the public key for
  third-party verification.
- **Sealed-content envelope.** Prompt and diff payloads are encrypted
  with libsodium sealed-box before they leave the daemon. The recipient
  is the engagement's evaluator pubkey, fetched at engagement install
  and pinned with a corresponding entry in the transparency log.
- **Idempotency.** Receipt ID = `blake3(engagement_id || session_id ||
  sequence)`. Replays no-op.
- **Backpressure.** Daemon spool is an encrypted SQLite at
  `~/.local/share/tokenshelf-agent/spool.db`, key sealed to the OS
  keychain. Spool capacity is configurable (default 1 GiB) and the
  daemon surfaces a clear warning at 90% capacity.

---

## 7. Storage

### 7.1 Relational store

Tables (extending the existing TokenShelf schema):

- `engagement` — engagement metadata, builder roster, rubric pin,
  retention policy, consent state per builder.
- `session` — capture-mode, daemon version, byte counts, encrypted
  blob URI, sealed-box envelope metadata.
- `receipt` — token-spend events. Adds `PROXIED-LOCAL` trust tier
  for daemon-captured proxied receipts.
- `score` — per-PR aggregate score, contributing-signal breakdown,
  sanity-layer flag, rubric version, judge triple.
- `consent` — engagement-level and session-level consent state with
  revocation timestamps.
- `audit_event` — append-only log of privileged actions and prompt-blob
  reads.

Row-level access policies enforce: builders see only their own data;
a.team admins see only their org's engagements; buyers see only the
engagements they paid for, scoped further by builder consent.

### 7.2 Object store

Blob layout: `<engagement>/<session>/{prompt.bin, diff.bin, metadata.json}`.

Encryption: per-session DEK (AES-256-GCM) wrapped by per-engagement
KEK in the HSM-backed KMS. Crypto-shred at retention end deletes the
KEK; encrypted blobs become impractical to recover without
operator-grade forensic capability against the cloud provider itself.

Retention default: 90 days after engagement end. Configurable per
engagement under the consent flow. Soft-delete then crypto-shred
sequence is logged to the audit table and the public transparency log.

---

## 8. Evaluator pipeline

### 8.1 Trigger

End-of-PR-merge is the primary trigger. The sanity layer can also be
invoked on end-of-session for outlier detection, but the score that
affects the builder profile is computed at PR-merge.

### 8.2 Pipeline steps

1. Fetch encrypted session blobs from object store for all sessions
   within the PR's lifetime.
2. Unwrap per-session DEKs via KMS. KMS logs each unwrap call.
3. Decrypt blobs in evaluator-VM memory only. Never written to disk.
4. Apply PII redactor (two-pass: regex set from open `tokenshelf-
   redactor` repo + entity-NER for cohorts under regulated jurisdictions).
5. Compute objective signals (pure functions). This is the primary
   score.
6. Run sanity-layer judge over the redacted session content for
   outlier detection + qualitative summary.
7. Write score record + judge trace (encrypted, same retention policy
   as session blobs) to object store; write score-row to relational
   store.
8. Destroy evaluator VM.

### 8.3 Isolation requirements

- Hardware isolation (microVM, enclave, equivalent). Specific
  implementation chosen by a.team based on cloud/residency posture.
- No internet egress except to the pinned LLM endpoint, allow-listed
  by IP + SNI.
- No persistent state between evaluations. Fresh boot per session.
- Resource caps per evaluation to bound DoS exposure (see
  `a-team-security.md` §6).

---

## 9. Identity and access

- **Builders.** SSO via the IdP a.team already runs. Daemon mTLS
  certificate minted post-SSO with engagement scope.
- **a.team account managers.** Scoped per engagement; see scores and
  rubric breakdowns. **Cannot** read raw prompts without triggering a
  "deep audit" workflow that notifies the builder and writes a
  permanent audit-log entry.
- **Buyers.** Scoped per engagement, further gated by builder consent.
  See aggregate scores only by default; session-level visibility is
  opt-in by the builder.
- **a.team org admins.** No prompt-content read access. Only scores,
  audit metadata, and consent state.

---

## 10. Open-source posture

| Repo | License | Content |
|---|---|---|
| `tokenshelf-agent` | Apache-2.0 | Rust daemon. Everything that runs on a builder's machine. |
| `tokenshelf-rubric` | Apache-2.0 | Scoring rubric versions, full judge prompt template, aggregation formula, calibration-set definitions. |
| `tokenshelf-redactor` | Apache-2.0 | PII regex set and entity-NER configurations. Used by both daemon and server. |
| `tokenshelf-verifier` | Apache-2.0 | Third-party tool for receipt-signature verification and transparency-log lookups. |
| `tokenshelf-api` | Closed-source, commercial license, **third-party source escrow** | Ingest API, storage layer, evaluator orchestration, admin + buyer views. |

The asymmetric split: builders trust open code for everything that
runs on their machine and everything that defines how they're scored.
The closed server is a thick pipe between published inputs and
published outputs.

Source escrow on the closed server addresses single-vendor and
key-person risk. Trigger conditions and named technical successor are
in the commercial agreement.

---

## 11. Operational model

a.team operates the production deployment in its own cloud or on-prem
infrastructure. TokenShelf (Gestion A. Paquet inc.) provides:

- Maintenance of the open-source repos.
- Maintenance of the closed-source server under license.
- Rubric calibration data and version updates.
- A named technical successor on file.

Compliance posture (SOC 2 Type II, ISO 27001, GDPR, EU AI Act,
jurisdiction-specific employment monitoring) is a.team's to define and
maintain, since data resides in their tenancy.

---

## 12. What the architecture brief does not specify

The following are deliberately left for a.team's engineering team to
choose during the implementation discovery:

- Specific cloud provider, region(s), and residency policy.
- Specific KMS / HSM implementation.
- Specific hardware-isolation runtime for the evaluator (Firecracker,
  Nitro Enclaves, Kata, etc.).
- Specific transparency-log implementation (Sigstore Rekor, Trillian,
  on-prem Merkle log).
- Specific IdP integration (whichever a.team already runs).
- Specific judge LLM provider and zero-retention contract terms.
- Specific source-escrow vendor and release-trigger conditions.

The architecture is the same regardless of which selections are made.
That's the point of stating it substrate-agnostic.
