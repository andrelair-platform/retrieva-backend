# Architecture & Data Findings — Retrieva

> Audit pass, 2026-10-29. Cross-cutting review. **[CONFIRMED]** = observed this pass; **[HYPOTHESIS]** =
> needs investigation (tracked in the backlog, not asserted as a defect). No fixes applied here.

## 1. Domain boundaries & responsibilities
- **[CONFIRMED]** Modular monolith; modules own `routes/controller/schema/types` and call **shared**
  `services/` + `repositories/` (`modules/README.md`). Cross-module calls go through a shared service.
- **[CONFIRMED gap]** Ownership of **arrangement vs assessment vs decision** records is split across
  `arrangements`, `arrangementAssessment`, `assessment`, `decisionQueue`, `approvals`. Several
  "assessment" concepts coexist (`assessments.ts`, `assessmentRuns.ts`, `arrangementAssessment`). →
  needs a single documented ownership map (backlog `P1-05`).
- **[CONFIRMED]** Scope-adjacent logic (`evaluations` ranking, `exit-strategy` enrichments) is **not
  isolated** behind a boundary/flag today — it is first-class in the API + UI.

## 2. Data model, relationships, invariants
- **[CONFIRMED]** 39 schema files; relations centralised in `relations.ts`. Append-only tables exist
  (`actionAudit`, `auditLog`, `doraScoreHistory`, `reportabilityDeterminations`).
- **[CONFIRMED]** `reportabilityDeterminations` invariant holding on dev: append-only, 1 current row per
  arrangement reduced by `listByOrg` newest-first; backfill `determined_by IS NULL`, human rows carry an
  actor (verified §4 baseline).
- **[HYPOTHESIS]** No automated check that **every arrangement has ≥1 determination** (the backfill
  guarantees it today, but a newly-promoted arrangement relies on `confirmProposal` seeding one). Needs a
  data-integrity test (`P2-01`).
- **[HYPOTHESIS]** FK/orphan integrity across `arrangementProposals → arrangements`,
  `evidence → arrangements`, `substituteProviders/exitArtefacts → arrangements` not verified. (`P2-01`).

## 3. Workflow state transitions & error handling
- **[CONFIRMED]** The consistent pattern is **async propose-into-inbox**: `discovery`, `completeness`,
  `surveillance`, `questionnaire`, `assessment` enqueue a job (`runId`) → worker writes
  `*_runs` + inbox rows → UI polls. "Drafting/informing, never auto-apply" is explicit in module headers
  (`amendments`, `completeness`, `ddq-contradictions`, `surveillance`, `exit-strategy`).
- **[HYPOTHESIS]** Worker **idempotency, retry, and partial-failure** behaviour is unverified; `types/jobs.ts`
  defines the job shape but the de-dup/retry guarantees need a test (`P2-06`). Risk: duplicate inbox rows
  on re-run, or a stuck `*_runs` row on worker crash.
- **[HYPOTHESIS]** Behaviour when the **AI provider is unavailable** (LiteLLM down / rate-limited) — does a
  run fail closed with a clear status, or hang? Unverified (`P2-06`).

## 4. AI proposal ↔ human-approval boundary
- **[CONFIRMED — strong]** This is the product's best-defended invariant. Verified in code:
  `reportability.controller.ts` hard-denies a SERVICE principal (403 before `can()`); `amendments`
  never auto-applies; `completeness`/`surveillance` "inform, never auto-change". The capability map
  (`config/authz/capabilities.ts` v1.4.0) grants `reportability:determine` only to checker/admin roles.
- **[HYPOTHESIS]** The **contract is not standardised** across modules — each inbox/approval re-implements
  its own propose→accept/reject→audit shape. A single documented "AI-proposal / human-decision / audit-event"
  contract would reduce drift and is testable (`P1-06`).

## 5. Authorization, SoD, tenant isolation
- **[CONFIRMED present]** `can()` capability map (default-deny), `requireCap`, principal-type guard,
  `setEntityContext`/`runWithEntityScope` (RTV-54 row-level isolation), org-scoped repos, `action_audit`.
- **[HYPOTHESIS — must test]** Correctness under adversarial input: cross-tenant read/write attempts,
  missing-org principals, wildcard-grant edge cases, and the `requireActivePlan` fail-open already flagged
  in **`retrieva-backend#156`**. → `P0-07` (sensitive-op isolation tests) + fold `#156`.

## 6. Audit history & evidence traceability
- **[CONFIRMED]** Append-only `action_audit` with actor-type/tenant/decision/result; evidence library
  links uploads to arrangements; `doraScoreHistory` retains score evolution.
- **[HYPOTHESIS]** End-to-end **traceability chain** (evidence → assessment verdict → determination →
  register row) is not asserted by a test; citations in `ddq-contradictions` need grounding verification
  (`P2-02`).

## 7. Register of Information — generation & validation
- **[CONFIRMED]** Register is a **projection of the graph**, generated on demand (no stored copy);
  working view = `getRegister`, formal view = `exportRegister` → `buildRegister(id,{formal:true})`.
  Cutover OFF → formal == working (parity). Templates in `config/register/rt0201FieldMap.ts`
  (B_01/B_02/B_03/B_05 + gaps).
- **[HYPOTHESIS — priority]** No **field-level validation against a versioned EBA ITS spec** is asserted
  in CI (the market pain is the 6.5% pass rate). The `completeness` agent audits structural gaps, but
  there is no pinned reference-spec conformance test (`P0-06`). Needs the authoritative RT.02.01 template
  version pinned + a validation fixture.

## 8. Test coverage & regression risk
- **[CONFIRMED]** 149 unit / 40 integration / **1 e2e**. The thin e2e layer is the main regression risk:
  **no asserted golden path** discovery→intake→assessment→determination→register (`P2-01`).
- **[HYPOTHESIS]** ADR-0005 A4/A5 (formal split + reconciliation) parity is covered by A-story tests but
  the A6 suite (`#175`) is open → confirm the parity + rollback assertions exist and pass (`P0-05`).

## 9. Migration safety & recovery
- **[CONFIRMED]** 0034 is additive + backfill (no destructive DDL); runs at start. Dev CNPG has a
  scheduled backup (`retrieva-postgres-backup-*` CronJob observed). Platform CNPG restore is a proven
  pattern (ADR cnpg-standard).
- **[HYPOTHESIS]** No rehearsed **restore drill for the Retrieva dev DB specifically**; migration
  **rollback story** (0034 is additive so forward-only is fine, but document it) (`P2-07`).

## 10. Observability, reliability, operational readiness
- **[CONFIRMED]** OpenTelemetry (`instrument.js`), Langfuse LLMOps (own project), health routes.
- **[HYPOTHESIS]** No documented SLO / golden-path synthetic check / runbook set for Retrieva
  specifically; worker liveness + schedule-flag state (`*_SCHEDULE_ENABLED`) not surfaced in a dashboard
  (`P3-04`).

---

### Confirmed-vs-hypothesis summary
**Confirmed strengths:** modular boundaries; the AI-proposes/human-decides invariant; append-only audit;
register-as-projection + verified parity; additive migration.
**Top investigation targets (become P0/P1):** RT.02.01 field-level validation (`P0-06`), tenant-isolation
adversarial tests + `#156` fail-open (`P0-07`), golden-path e2e (`P2-01`), standard HITL contract
(`P1-06`), worker idempotency/AI-unavailability (`P2-06`).
