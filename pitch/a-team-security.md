# TokenShelf for a.team — Security and threat model

**Companion to** [`a-team.pdf`](./a-team.pdf) and
[`a-team-architecture.md`](./a-team-architecture.md). For a.team's
security review team. ~5 pages. Updated post-internal-red-team
(May 2026).

This document is intentionally adversarial. The pitch states the
security posture in five mechanisms; this document enumerates the
threats those mechanisms defend against, the threats they do not, and
how the gaps are managed operationally rather than cryptographically.

The original design draft included a universal MITM proxy as the
primary capture mechanism. **That design has been replaced** with
per-tool capture via official extensibility (see
`a-team-architecture.md` §4). The threats listed in section 4 of this
document apply to the *current* design, not the dropped one. The
appendix in section 9 records why the universal MITM was rejected so
the decision survives the team turnover that always happens between
proposal and production.

---

## 1. Threat model scope

**In scope.** Adversaries who attempt to:

- Read prompt content they are not authorized to read.
- Forge or alter receipts and scores.
- Game the scoring rubric.
- Cause denial of service or unbounded cost to a.team.
- Exfiltrate engagement-confidential information through aggregate
  inference or side channels.
- Compromise the daemon binary in supply-chain attacks.

**Out of scope.** Adversaries with capability to:

- Compromise the underlying LLM provider (Anthropic, OpenAI).
- Compromise a.team's KMS / HSM at the operator level.
- Compel a.team to produce blobs via subpoena (this is a known
  residual risk, not a defended threat).
- Compromise the OS or hardware of every builder simultaneously.

These out-of-scope adversaries are documented because the line between
defended and acknowledged-residual is itself a deliverable to a.team's
security review.

---

## 2. Five defended threat classes

Each defended threat maps to one or more of the five mechanisms stated
in the pitch. The mechanisms are listed once; the threats below
reference them by number.

### Mechanisms (from the pitch)

1. **Per-engagement consent gate** on the daemon.
2. **Sealed-content envelope** on the wire (libsodium sealed-box).
3. **Per-engagement key-wrapping at rest** in HSM-backed KMS, with
   crypto-shred at retention end.
4. **Hardware-isolated short-lived evaluator** with no internet egress
   except the pinned LLM endpoint.
5. **Append-only public transparency log** for daemon binary hashes,
   rubric hashes, evaluator pubkey rotations, and judge model versions.

### T1 — MITM between daemon and ingest API

**Adversary capability.** Active network adversary between the
builder's machine and the ingest endpoint.

**Mitigation.** mTLS with per-engagement client certificate (pinned at
install). Application-layer ed25519 signature on every receipt
payload (defense in depth — the application-layer signature survives a
TLS termination compromise). The receipt-verifier public key is
published at `/.well-known/tokenshelf-verify.json` for independent
third-party verification.

**Residual.** None material. mTLS + signed payload + public verifier
is the standard cryptographic posture.

### T2 — Compromised ingest API or server-side database

**Adversary capability.** Full read/write access to the closed-source
server, including the relational store and the object store.

**Mitigation.** Sealed-content envelope (mechanism 2). Prompt and diff
blobs are ciphertext from the daemon onward; the ingest API holds the
ciphertext but does not hold the corresponding private key. The
private key lives in the evaluator's HSM-backed KMS. Per-engagement
key wrapping (mechanism 3) means a single-engagement key compromise
does not cascade.

**Residual.** Score records themselves are stored in the relational
store and can be tampered with by an attacker who compromises the
server. Receipt and score *signatures* are checkable by the public
verifier; tampering produces a signature mismatch that any independent
party can detect. The audit log is append-only with periodic
transparency-log anchoring (see T4).

### T3 — Compromised builder machine

**Adversary capability.** Same-user-level access to the builder's OS.

**Mitigation.** Per-engagement consent gate (mechanism 1). The daemon
refuses to start without an active engagement context, so the
attacker gains no new TokenShelf-mediated capability. Provider API
keys live in the OS keychain — the worst-case exposure is the
builder's own provider key, not anything a.team holds.

**Residual.** The OS keychain on macOS gates on the daemon's code-
signing identity. If Apple revokes a.team's Developer ID (rare,
historical precedent in Zoom 2019), the daemon stops accessing its
own keys but the keys themselves remain. The same-user-binary risk on
Windows Credential Manager is documented as a known limitation; the
daemon defends with prompt-fatigue limits (max one keychain unlock
per session) and surfaces unlock events to the builder.

### T4 — Append-only log tampering

**Adversary capability.** An a.team operator with write access to the
score store or audit log attempts to retroactively alter scores or
hide a read event.

**Mitigation.** Append-only relational table with periodic Sigstore-
compatible transparency-log anchoring (mechanism 5). The transparency
log is publicly mirrored. A builder can verify that any score
attributed to them was anchored before the current time and that no
intervening anchor has reorganized the log.

**Residual.** The latency between a score event and the next anchor
window (default: hourly) is a non-anchored interval. A determined
operator could alter a row within the hour before the anchor is
published. This is documented for the audit team and the anchor
cadence is configurable.

### T5 — Insider read of prompt content

**Adversary capability.** An a.team account manager or admin attempts
to read a builder's raw prompt content from an engagement they are
authorized to manage.

**Mitigation.** Reading raw prompt blobs requires a "deep audit"
workflow that (a) issues a KMS unwrap event logged to the operator's
cloud audit trail, (b) writes a permanent entry in the TokenShelf
audit-event table that is anchored to the transparency log, and
(c) notifies the builder via the daemon's status surface on next sync.

**Residual.** Procedural, not cryptographic. An admin determined to
violate policy *can* read content during a legitimate deep-audit
window. The mitigation is the strong attribution + immutable
notification, not prevention. Section 6 of this document discusses
this further under the insider-threat header.

### T6 — Builder gaming the LLM sanity layer

**Adversary capability.** A malicious or strategically gaming builder
embeds adversarial content in their prompts to manipulate sanity-layer
output.

**Mitigation.** *The sanity layer does not produce the primary score.*
This is the most important design choice in the system for this
threat class. Objective metrics (tokens-per-merged-PR, retry-to-green,
revert-within-14-days) are computed from receipts and GitHub events —
they cannot be prompt-injected because they don't pass through the
LLM. The sanity layer only flags outliers and provides qualitative
review on appeal.

Additional defenses where the sanity layer is involved:

- Structured JSON output schema; free-text reasoning stored
  server-side but never echoed to the builder.
- Inter-rater calibration with a *triple* of pinned models (not a
  pair) so single-model adversarial transfer is harder.
- Held-out historical calibration set re-judged weekly to detect
  absolute drift independent of inter-rater agreement.
- PII redactor + Unicode-normalization sanitizer applied before judge
  input. The redactor rule set is open in `tokenshelf-redactor`.

**Residual.** Sophisticated adversarial prompts can still bias the
sanity layer. Because the sanity layer is not the primary score, the
practical attack surface is limited to manipulating outlier flags and
qualitative summaries. This is documented and the security team
should commission a periodic red-team against the deployed judge.

### T7 — Forgery of receipts

**Adversary capability.** A builder or an attacker with the builder's
machine attempts to inflate token counts or invent merged PRs to
improve scores.

**Mitigation.** Receipts have a trust tier (`VERIFIED | PROXIED |
SELF_REPORTED`). The primary score weights `VERIFIED` receipts
strongly and discounts `SELF_REPORTED` aggressively. The `VERIFIED`
tier comes from the provider's own Admin API and cannot be forged
without compromising the provider. GitHub merge events come from the
GitHub OAuth scope and are verifiable against the public API.

**Residual.** A builder can pad `SELF_REPORTED` receipts. The scoring
weights are tuned to make this not worth doing.

### T8 — Cross-engagement data leakage in the evaluator

**Adversary capability.** A malicious payload submitted by one
engagement's builder attempts to extract data from another
engagement's evaluation, e.g., via VM-escape, side-channel, or
resource exhaustion.

**Mitigation.** Hardware isolation (mechanism 4). Fresh sandbox per
evaluation, destroyed on completion. No persistent state between
evaluations. No internet egress except the pinned LLM endpoint. CPU
pinning + dedicated tenancy for the evaluator fleet (configurable).

**Residual.** VM-escape CVE history exists; hardware isolation is
strong but not absolute. Side-channels via the pinned LLM endpoint
(timing, billing) are possible in theory; mitigated by batching and
constant-rate scheduling that decouple individual evaluations from
externally observable signals.

---

## 3. Three named residual risks

These are real and they are stated in plain language in the pitch
callout. Each has a mitigation path that is operational, not
cryptographic.

### R1 — a.team KMS / HSM compromise

**What it looks like.** Operator-level access to the KMS export
attack surface, key-material exfiltration via misconfigured policy,
or a.team-side insider with HSM credentials.

**Why it is residual, not defended.** Every cryptographic guarantee in
the system reduces to the integrity of the KMS root. There is no
self-defending construction.

**Mitigation path.**

- SOC 2 Type II with explicit scope on KMS operations.
- Quarterly third-party security audit with public attestation report.
- Key rotation cadence documented and enforced.
- KMS operation logs (CloudTrail, GCP Audit Logs, or equivalent)
  exported to a write-once destination outside a.team's primary
  cloud account.
- Pre-signed *evaluator key rotation events* in the transparency log
  so builders can detect attacker-controlled rotation attempts.

### R2 — LLM provider retention under their published terms

**What it looks like.** The judge LLM provider retains evaluation
traffic under their default terms; in regulated cohorts this is
disclosable to builders and may not be legally permitted.

**Why it is residual.** The judge runs on third-party provider
infrastructure outside a.team's control.

**Mitigation path.**

- Negotiate zero-retention dedicated capacity for evaluation traffic
  at contract signing. Anthropic and OpenAI both offer this for
  enterprise customers at a.team's expected scale.
- Include the provider's zero-retention attestation in the
  pre-pilot privacy memo.
- Document the residual in the builder consent flow so consent is
  informed.

### R3 — Subpoena exposure during the active engagement window

**What it looks like.** A government subpoena, National Security
Letter, or civil discovery request compels a.team to produce session
blobs during the 90-day active+retention window where blobs are still
decryptable.

**Why it is residual.** Crypto-shred protects post-retention data; it
does not protect active-engagement data, by definition.

**Mitigation path.**

- Shortest defensible retention window per engagement (default 90
  days post-engagement; configurable down to 14 days for sensitive
  cohorts).
- Explicit disclosure in the builder consent flow that active-window
  blobs are within legal-process scope.
- Pre-negotiated provider zero-retention (R2) reduces the scope of
  what a.team itself holds.
- Builder-side daemon supports immediate redaction request that
  overwrites the stored blob with a redaction marker; the redaction
  itself is logged but the original content is unrecoverable.

---

## 4. Specific attack vectors with mitigations

This section addresses concrete attack classes raised in the security
red-team review.

### 4.1 Daemon supply-chain attack

**Vector.** Compromise of a.team's GitHub Actions build pipeline; a
maintainer's signing identity; or a transitive Rust dependency.

**Mitigations.**

- Reproducible builds via locked `Cargo.lock`, pinned `RUSTC_BOOTSTRAP`,
  explicit `RUSTFLAGS`, identical linker per OS target. Acknowledged
  to be harder for macOS/Windows than Linux; CI matrix exercises
  reproducibility on every release.
- SLSA L3 build provenance via `slsa-github-generator` with explicit
  hermeticity controls. Build runs in a self-hosted runner pool, not
  generic GitHub-hosted runners.
- Sigstore cosign signatures with keyless OIDC binding to a.team's
  GitHub Actions identity.
- `tokenshelf-verifier` (separately distributed; not the daemon
  itself) confirms that the running binary's hash matches the
  transparency log entry. Self-check by a compromised binary is not
  trusted; verification is by an independent tool installed via a
  separate trust path (Homebrew tap signed by a different key, etc.).
- `cargo-vet` / `cargo-crev` audit attestations checked in to the
  repo. Dependency-addition PRs require maintainer review with vet
  status visible.
- Commit signing required on all merges to release branches.
  Branch-protection rules enforced.

### 4.2 Sealed-box pinning and key rotation

**Vector.** A compromised ingest API serves the daemon an
attacker-controlled evaluator pubkey at install time, or substitutes
the pubkey during a legitimate rotation event.

**Mitigations.**

- Evaluator pubkey is published to the transparency log alongside its
  rotation history. The daemon verifies the pubkey it receives against
  the log entry before accepting it.
- Pubkey rotation requires *two* signatures: one from a.team's
  signing identity, one from an independent third-party signer
  configured at contract time (could be the source-escrow vendor).
- Daemon supports a TOFU + cosign-style multi-party verification at
  install. The builder is shown the log entry hash and rotation
  history.
- Forward-secrecy gap of sealed-box is acknowledged: a single key
  compromise decrypts all prior sealed envelopes encrypted under that
  key. This is the rationale for short retention windows on prompt
  blobs and per-engagement KEKs that bound the blast radius.

### 4.3 Crypto-shred backup propagation

**Vector.** Encrypted blobs persist in S3 versioning, RDS automated
snapshots, or replicated buckets after the KEK is deleted, leaving
ciphertext accessible to anyone who can recover the KEK from a backup.

**Mitigations.**

- KMS keys are *not* versioned (no automatic key rotation that
  creates retainable old versions). Key rotation is performed by
  generating a new key and re-wrapping live DEKs under it; old keys
  are scheduled for destruction.
- Backup snapshots are themselves encrypted with a *different* KMS
  key that has explicit lifecycle policy excluding backed-up KEK
  ciphertext.
- Audit-log content schema is restricted to metadata (read action,
  actor, timestamp, blob URI) — not prompt content. The reasoning
  trace of any judge invocation that quotes prompt content is
  encrypted under the same per-engagement KEK as the source blob,
  so it crypto-shreds in the same event.
- The "crypto-shred" claim in builder-facing communications is
  precise: *"deleting the KEK renders the blob impractical to
  recover without operator-grade forensic capability against the
  underlying cloud provider's storage layer."* Not "impossible."

### 4.4 Insider-collusion exfiltration

**Vector.** An a.team admin colludes with a malicious builder to
extract prompt content from a buyer's engagement during a legitimate
"deep audit" window.

**Mitigations.**

- This is acknowledged as procedural, not cryptographic. The
  technical controls (audit log + transparency log anchoring +
  builder notification) ensure the read is attributed and discoverable.
- The buyer-facing surface does not expose raw prompts. Buyers see
  scores. Even with a corrupt admin, no automated read path exfils
  content directly to the buyer.
- a.team's NDA + employment contracts and the buyer's NDA with the
  builder are the legal closure.

### 4.5 Denial of service / cost-amplification

**Vector.** A malicious builder generates spam sessions to drive up
a.team's evaluator LLM costs.

**Mitigations.**

- Per-engagement spend cap enforced server-side (not client-side; a
  malicious daemon ignores client-side caps).
- Per-builder rate limit: max N sessions per hour, configurable per
  engagement.
- Anomaly detection on session-creation rate triggers automatic
  cap-down + a.team admin alert.
- Evaluator queue priority demotes flagged builders so legitimate
  traffic is not starved.

### 4.6 Reverse-engineering prompts from scores

**Vector.** A buyer who sees session-level scores and rubric
breakdowns infers prompt content.

**Mitigations.**

- Buyer-facing surface defaults to aggregate-only. Session-level
  visibility is opt-in by the builder, not opt-out.
- Reasoning traces from the judge are not exposed to buyers. They
  are stored server-side for builder appeal, and encrypted under the
  same per-engagement KEK.
- Aggregate scores are smoothed (configurable: weekly aggregates, no
  daily granularity for sensitive cohorts) to prevent
  high-resolution inference attacks.

---

## 5. Compliance posture

The pitch's third pre-pilot deliverable is a privacy counsel
memorandum from named outside counsel. It covers, at minimum:

- **EU AI Act** (in force May 2026) — high-risk-employment categorization
  if scores affect employment decisions. Mitigated by keeping scores
  advisory and never determinative.
- **NYC Local Law 144** — automated employment decision tools.
  Disclosure required if any score is used as a factor in builder
  selection or pay.
- **GDPR** — lawful basis filing per builder cohort; data subject
  rights (access, deletion, portability) exposed via the daemon UI.
- **Canada Law 25** — consent and purpose limitation; cross-border
  transfer disclosure if a.team's infrastructure is outside Quebec.
- **California CPRA** — sensitive personal information categorization
  if prompts contain client identifiers.
- **France and Germany works councils** — works-council notification
  + co-determination process if any French/German builder is
  enrolled.
- **Employee monitoring laws** — NY, CA, Ontario, Massachusetts,
  Connecticut, Delaware notice requirements.

The memo is a one-page matrix with jurisdiction × applicable law ×
lawful basis × notice requirement × residual obligation. It is
attached to the pitch packet, not delivered later.

---

## 6. Insider-threat operational controls

Threat T5 and section 4.4 cover insider-collusion in technical terms.
This section enumerates the operational controls that close the gap.

- **Quarterly access review** of every account with `deep_audit`
  capability. The list is short by design.
- **Two-person rule** on any deep-audit invocation. A second admin
  must approve before the KMS unwrap is authorized.
- **Mandatory cooling-off** between deep audits on the same engagement
  (default 24 hours) to prevent rapid-fire enumeration.
- **Builder notification within 60 minutes** of any deep audit
  read. The transparency log anchor for the event is published
  within the same window.
- **Annual third-party access audit** with public attestation
  summary (counts, no PII).

---

## 7. What this document does not promise

To be explicit, so the security review has a clear list of
limitations:

- No defense against the LLM provider acting in bad faith. Mitigated
  by zero-retention contract terms.
- No defense against a.team's CISO or CTO acting in bad faith.
  Mitigated by the legal regime and the transparency log.
- No defense against active-engagement subpoena. Mitigated by short
  retention.
- No defense against a perfect VM-escape exploit chain. Mitigated by
  per-engagement isolation and dedicated tenancy options.
- No defense against builder collusion to game *relative* scoring
  baselines. Mitigated by mixing relative and absolute calibration.

---

## 8. Pre-pilot security deliverables

In addition to the three pre-pilot deliverables in the pitch
(calibration data, builder LOIs, privacy memo), the following are
delivered to a.team's security team specifically:

1. **Red-team report against the deployed sanity-layer judge.** At
   least 100 adversarial sessions. Findings + remediations.
2. **SBOM for the daemon binary** (CycloneDX format). Per-platform.
3. **Threat model walkthrough** with a.team's security architects.
   This document is the starting point.
4. **Sample KMS / HSM operational runbook** that a.team's SRE team
   can adapt or replace.
5. **Crypto-shred verification procedure** that a third party can
   execute to confirm a retention-end deletion was effective.

---

## 9. Appendix — Why the universal MITM proxy was rejected

The original design draft included a daemon-operated local TLS
proxy that would install a root certificate authority in the
builder's OS trust store and intercept all AI tool TLS traffic. This
section documents why that design was dropped, because the failure
mode if it is re-proposed later is identical.

**Threats with the universal MITM design.**

- A local root CA without RFC 5280 §4.2.1.10 Name Constraints is a
  universal MITM root for every TLS client on the machine. Name
  Constraints are not consistently respected by non-browser TLS
  clients in 2026. The Superfish/Dell eDellRoot incident remains the
  canonical reference.
- The CA private key on the builder's machine becomes a primary
  target. Same-user-level malware (RedLine, Lumma, AMOS) routinely
  extracts material from OS keychain via legitimate platform tools.
  CWE-522.
- macOS code-signing dependency creates an operational SPOF. Apple
  notarization revocation (Zoom 2019) would break the daemon's
  ability to read its own keys while leaving the CA trusted by
  other applications.
- Managed-device MDM policies block user-installed root CAs entirely
  on the corporate-managed machines that are exactly a.team's buyer
  population.
- OS-level warnings on root CA install in macOS Sequoia and Windows
  11 24H2 train builders to accept MITM roots, which is itself a
  security-posture cost a.team would be liable for.

**Why per-tool capture is better.**

- No new root CA in the trust store.
- Each tool's capture surface is the tool's own published
  extensibility (OpenTelemetry, log files, admin APIs). Stable trust
  boundaries.
- Coverage is partial — explicitly. The pitch acknowledges this.
  Honest partial coverage beats false universal coverage.
- Builder consent flow is simpler: no "install this root certificate"
  step that triggers IT-policy escalation.

The trade is real (some AI tools are not captured, notably GitHub
Copilot until a partnership opens an admin API). The pitch is honest
about it on page 2 of the PDF.
