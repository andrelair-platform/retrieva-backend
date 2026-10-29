# Consolidation Backlog — Retrieva

> Audit pass, 2026-10-29. Executable, evidence-based backlog to consolidate, correct and complete the
> existing product **without adding features**. Each item carries: module/files · evidence · severity ·
> keep/fix/refactor/separate/defer/remove decision · dependencies · proposed change · acceptance
> criteria · required tests · rollback · effort · confidence. Grouped **P0→P3**.
>
> **Constraints (binding):** audit/plan first; no new features; no production changes; never alter
> historical regulatory decisions or overwrite append-only evidence; do not change Register semantics
> without explicit analysis + authorization; preserve data/API compatibility unless a justified
> migration plan exists; prefer small reviewable PRs; nothing marked done without evidence.

Severity: **S1** blocks a correctness/regulatory/security claim · **S2** material · **S3** hygiene.
Confidence: **H/M/L** (how sure the item is correctly scoped). Effort: dev-days, rough.

---

## P0 — Baseline & correctness (must precede everything)

### AUD-P0-01 — Inventory modules/routes/workers/jobs/flags
- **Module/files:** repo-wide; `modules/`, `routes/`, `workers/`, env flags.
- **Evidence:** baseline doc §2 (done this pass) — formalise as a living inventory doc.
- **Severity/Decision:** S3 / **keep** (document). **Deps:** none (independent).
- **Proposed change:** none to code — publish `docs/audits/repository-baseline.md` (this PR).
- **AC:** every module/worker/flag listed with purpose + owner. **Tests:** n/a (doc).
- **Rollback:** delete doc. **Effort:** 0.5. **Confidence:** H.

### AUD-P0-02 — Dependency map (module↔module, API, DB, events)
- **Files:** `relations.ts`, `services/*`, `modules/*/*.routes.ts`, `workers/*`.
- **Evidence:** cross-module calls go via shared services (`modules/README.md`); not yet mapped.
- **Severity/Decision:** S2 / **document**. **Deps:** P0-01. **Independent:** yes.
- **Change:** add a dependency table + a Mermaid graph to `architecture-and-data-findings.md`.
- **AC:** every adjacent-module edge (esp. `evaluations`→`cmdbAssetRefs`/`arrangements`) documented.
- **Tests:** n/a. **Rollback:** doc. **Effort:** 1. **Confidence:** M.

### AUD-P0-03 — Triage open issues/PRs (keep/fix/defer/close/dup)
- **Evidence:** board #2 ~50 open (mostly feature EPICs); backend #170–#175, #184–#186, #156.
- **Decision:** S3 / **groom** — close merged A-stories (#170–#173,#175 if A6 proven), freeze #626/#627/#628/#443/#424/#420, keep #156/#184/#185/#186.
- **Deps:** P0-05 (before closing #175). **Independent:** partly.
- **AC:** every open issue labelled keep/fix/defer/freeze/close. **Tests:** n/a. **Rollback:** reopen.
- **Effort:** 0.5. **Confidence:** H.

### AUD-P0-04 — Confirm ADR-0005 / migration 0034 deployed (dev) — **DONE this pass**
- **Evidence:** dev SQL — 24 arrangements ↔ 24 determinations, all `legacy_assumed_reportable` /
  `determined_by IS NULL`, `cmdb_asset_refs` present, enum complete; cutover OFF → register parity.
- **Severity/Decision:** S1 / **verified keep**. **Deps:** none.
- **AC:** ✅ met (baseline §4). **Tests:** add a migration-idempotency CI assert (`P2-07`).
- **Rollback:** n/a. **Effort:** 0 (done). **Confidence:** H.

### AUD-P0-05 — Prove ADR-0005 A4/A5 parity + rollback (close A6 #175)
- **Module/files:** `services/reportability/formalRegister.ts`, `reconciliationService.ts`,
  `services/registerProjectionService.ts`, `tests/unittest/*reportab*`, `*register*`.
- **Evidence:** cutover flag gates the filter; A6 test story (#175) still open.
- **Severity/Decision:** S1 / **fix (test)**. **Deps:** P0-04. **Independent:** yes.
- **Change:** ensure tests assert: flag OFF ⇒ `exportRegister` byte-identical to `getRegister`; flag ON ⇒
  only `reportable` + contracted-lifecycle arrangements included; reconciliation never flips the flag.
- **AC:** parity + cutover + rollback (flag back OFF restores parity) all green; #175 closable with evidence.
- **Tests:** unit parity/cutover/rollback; 1 integration on seeded data. **Rollback:** n/a (tests).
- **Effort:** 1.5. **Confidence:** H.

### AUD-P0-06 — RT.02.01 field-level validation vs a **pinned** EBA ITS spec
- **Module/files:** `config/register/rt0201FieldMap.ts`, `services/registerExportService.ts`, `modules/completeness`.
- **Evidence:** only structural gap audit today; no versioned conformance (findings §7). **This is the 6.5% pain.**
- **Severity/Decision:** S1 / **fix**. **Deps:** P0-05. **Independent:** yes.
- **Change:** pin the applicable RT.02.01 template version; add a fixture asserting each required field is
  produced with the correct type/cardinality for B_01/B_02/B_03/B_05 + subcontracting. **No semantic change
  to generation** — validation only (constraint-safe).
- **AC:** a conformance test fails on a missing/mistyped required field; passes on the seeded register.
- **Tests:** schema-conformance fixture test. **Rollback:** remove test. **Effort:** 3. **Confidence:** M
  (depends on sourcing the authoritative ITS template).

### AUD-P0-07 — Tenant isolation + authz on sensitive ops (fold #156)
- **Module/files:** `services/security/can.ts`, `capabilities.ts`, `setEntityContext`, `requireActivePlan`, all write controllers.
- **Evidence:** controls present (findings §5); `#156` flags a `requireActivePlan` fail-open.
- **Severity/Decision:** S1 / **fix + test**. **Deps:** P0-02. **Independent:** yes.
- **Change:** adversarial tests (cross-tenant read/write → 404/403; missing-org principal; SERVICE on
  `reportability:determine` → 403); fix `#156` fail-open.
- **AC:** no cross-tenant leak; fail-closed on null/undefined entitlement; SERVICE hard-deny proven.
- **Tests:** integration authz/isolation suite. **Rollback:** revert fix. **Effort:** 2.5. **Confidence:** H.

---

## P1 — Scope & consolidation

### AUD-P1-01 — Isolate `evaluations` commercial ranking/selection (keep risk-assessment)
- **Files:** `services/evaluation/evaluationService.ts` (`rank`, `selectWinner`), `evaluations.ts`, frontend `(dashboard)/evaluations`.
- **Evidence:** "compare candidates → select winner → promote" = procurement (scope matrix §1).
- **Severity/Decision:** S2 / **separate (flag-gate, defer)** — **NOT remove** (`selectWinner` writes
  `cmdbAssetRefs` and promotes arrangements → load-bearing; scope matrix §4).
- **Deps:** P0-02. **Independent:** yes.
- **Change:** gate the commercial-ranking UI/endpoints behind a `EVALUATIONS_PROCUREMENT_ENABLED` flag
  (default OFF in demo profile); keep the per-candidate risk-assessment + promotion path ON. Reversible.
- **AC:** with flag OFF, the risk-assessment + asset/service branching still works; ranking UI hidden;
  no data migration; existing rows intact. **Tests:** flag ON/OFF behaviour; promotion still seeds a
  determination. **Rollback:** flip flag ON. **Effort:** 2. **Confidence:** M.

### AUD-P1-02 — Trim `exit-strategy` enrichments (keep exit plan)
- **Files:** `modules/exit-strategy`, `substituteProviders.ts`, `exitArtefacts.ts`, frontend `(dashboard)/exit-strategy`.
- **Evidence:** alt-provider matching + reintegration estimate = sourcing/capacity (scope matrix §1).
- **Severity/Decision:** S2 / **separate (flag-gate, defer)**. **Deps:** P0-02. **Independent:** yes.
- **Change:** gate alt-provider matching + reintegration behind `EXIT_ENRICHMENTS_ENABLED` (default OFF);
  keep CIF-gated exit-plan drafting.
- **AC:** exit plan still drafts for CIF arrangements with flag OFF; enrichment surfaces hidden; rows intact.
- **Tests:** CIF-gating + flag behaviour. **Rollback:** flip flag. **Effort:** 1.5. **Confidence:** M.

### AUD-P1-03 — Freeze non-essential SaaS issues
- **Evidence:** #626/#627/#628/#443/#424/#420 out of Art 28–30 (scope matrix §3).
- **Severity/Decision:** S3 / **defer**. **Deps:** none. **Independent:** yes.
- **Change:** label `frozen`/`out-of-scope`, comment the rationale; remove from active sprint.
- **AC:** none appear in the current sprint view. **Tests:** n/a. **Rollback:** unlabel. **Effort:** 0.25. **Conf:** H.

### AUD-P1-04 — Audit duplication (entities/APIs/decision flows/nav)
- **Files:** `assessments.ts`/`assessmentRuns.ts`/`arrangementAssessment`; `decisionQueue`/`approvals`; frontend `decision-inbox`/`approvals`/`risk-register`.
- **Evidence:** multiple "assessment"/"decision" concepts (findings §1).
- **Severity/Decision:** S2 / **document → refactor (later)**. **Deps:** P0-02. **Independent:** no (needs map).
- **Change (this phase = doc only):** produce the ownership/duplication map; propose a consolidation ADR.
  **No refactor executed now.**
- **AC:** each concept has one documented owner + a deprecation note for any duplicate. **Tests:** n/a.
- **Rollback:** doc. **Effort:** 1.5. **Confidence:** M.

### AUD-P1-05 — Clarify record ownership (arrangement/assessment/evidence/decision)
- **Deps:** P1-04. **Decision:** S2 / **document**. **Change:** an ADR naming the authoritative table +
  lifecycle per record type. **AC:** published ADR; referenced from module READMEs. **Effort:** 1. **Conf:** M.

### AUD-P1-06 — Standardise the AI-proposal / human-decision / audit-event contract
- **Files:** `decisionQueue`, `approvals`, each inbox (`*Proposals`, `*Findings`, `surveillanceEvents`), `actionAudit`.
- **Evidence:** pattern is consistent but re-implemented per module (findings §4).
- **Severity/Decision:** S2 / **refactor (shared contract)** — behaviour-preserving. **Deps:** P1-04.
- **Change:** a shared TS type + helper for propose→accept/reject→audit; adopt incrementally (no big-bang).
- **AC:** at least `reportability` + one other module use the shared contract; audit event shape identical.
- **Tests:** contract unit tests. **Rollback:** revert per module. **Effort:** 3. **Confidence:** L (scope to pin).

---

## P2 — Workflow hardening (correctness tests, no behaviour change)

### AUD-P2-01 — Golden-path e2e: discovery→intake→assessment→decision→register
- **Files:** `tests/e2e/*`, seeds. **Evidence:** only 1 e2e file (baseline §6). **Severity/Decision:** S1 / **fix (test)**.
- **Deps:** P0-05,P0-07. **Change:** one seeded journey asserting a provider flows to a register row.
- **AC:** green on seeded data in CI. **Tests:** the e2e itself. **Rollback:** n/a. **Effort:** 3. **Conf:** M.

### AUD-P2-02 — Contradiction detection grounded-evidence + precision/recall
- **Files:** `modules/ddq-contradictions`, eval scripts. **Severity/Decision:** S2 / **fix (eval test)**.
- **Deps:** P2-01. **AC:** citations resolve to real evidence; a labelled fixture reports precision/recall.
- **Tests:** AI-eval fixture. **Effort:** 2. **Conf:** L.

### AUD-P2-03 — Concentration + subcontractor calc verification
- **Files:** `modules/concentration`, `providerDependencies.ts`. **Severity/Decision:** S2 / **fix (test)**.
- **AC:** known-graph fixture yields expected concentration incl. nth-party. **Tests:** unit. **Effort:** 1.5. **Conf:** M.

### AUD-P2-04 — Art-30 gap detection + amendment review path
- **Files:** `modules/amendments`, `contractAmendments.ts`. **Decision:** S2 / **fix (test)**.
- **AC:** seeded contract with a missing clause ⇒ draft raised; accept/edit/reject audited; never auto-applied.
- **Tests:** integration. **Effort:** 1.5. **Conf:** M.

### AUD-P2-05 — Surveillance dedupe/triage/audit
- **Files:** `workers/surveillanceWorker`, `surveillanceEvents.ts`. **Decision:** S2 / **fix (test)**.
- **AC:** duplicate feed items collapse to one event; triage transitions audited; never auto-rerates.
- **Tests:** integration. **Effort:** 1.5. **Conf:** M.

### AUD-P2-06 — Worker idempotency / retry / AI-unavailability
- **Files:** `workers/*`, `types/jobs.ts`. **Decision:** S1 / **fix (test + maybe guard)**.
- **AC:** re-running a job produces no duplicate inbox rows; a crashed worker leaves a recoverable `*_runs`
  status; AI-down ⇒ run fails closed with a clear status (no hang). **Tests:** integration w/ fault injection.
- **Rollback:** revert guards. **Effort:** 3. **Conf:** M.

### AUD-P2-07 — DB migration idempotency + dev restore drill + 0034 rollback note
- **Files:** `db/migrate.ts`, CNPG backup CronJob. **Decision:** S2 / **fix (test + runbook)**.
- **AC:** migrate-twice is a no-op; a dev restore from backup is rehearsed + documented; 0034 forward-only
  rationale recorded. **Tests:** CI migrate-idempotency. **Effort:** 2. **Conf:** M.

---

## P3 — Release & evidence

### AUD-P3-01 — Architecture + regulatory traceability matrix (living)
- **Decision:** S3 / **document** (seed = this PR's `regulatory-traceability.md`). **Effort:** 1. **Conf:** H.

### AUD-P3-02 — Representative seeded demo scenarios
- **Files:** `scripts/seed:ktayl-register`. **Decision:** S3 / **fix (seed)**. **AC:** one command seeds a
  believable firm (entities/functions/providers/subcontractors) for the golden path + demo. **Effort:** 2. **Conf:** M.

### AUD-P3-03 — Publish automated regression/integration results
- **Decision:** S3 / **ops**. **AC:** CI publishes a test + coverage summary artefact per run. **Effort:** 1. **Conf:** M.

### AUD-P3-04 — Deployment/rollback/restore/operational runbooks + SLO/synthetic check
- **Decision:** S2 / **document + ops**. **AC:** runbook set for Retrieva; a golden-path synthetic check;
  worker-liveness + schedule-flag dashboard. **Effort:** 2. **Conf:** M.

### AUD-P3-05 — Certification evidence + manual-vs-AI value map
- **Decision:** S3 / **document** (reuse the value map already drafted). **Effort:** 1. **Conf:** H.

### AUD-P3-06 — Measure analyst time saved / decision quality / register completeness
- **Decision:** S2 / **benchmark** — the efficiency gains are currently **hypotheses**; benchmark them.
- **AC:** a measured before/after on ≥3 workflows. **Effort:** 3. **Conf:** L.

---

## Independent-execution set (no cross-deps — safe to parallelise)
`AUD-P0-01`, `AUD-P0-03` (except closing #175), `AUD-P1-03`, `AUD-P2-03`, `AUD-P2-04`, `AUD-P2-05`,
`AUD-P3-01`, `AUD-P3-05`. Everything else has the deps noted above.

## Dependency order (critical path)
`P0-01 → P0-02 → P0-07` and `P0-04(done) → P0-05 → P0-06` are the two independent P0 chains; both must be
green before the **register cutover** (owner-gated, #174/#185) and before P2-01 (golden path). P1 scope
isolation (P1-01/02) depends only on P0-02 and is reversible, so it can run alongside the P0 test chain.
