# Repository Baseline — Retrieva (verified actual state)

> **Audit pass, 2026-10-29.** Evidence-based inventory of the *actual* state of the Retrieva product
> (`retrieva-backend` + `retrieva` frontend). This pass is **audit + plan only** — no refactors, no
> deletions, no feature work. Every row is tagged **[CONFIRMED]** (observed directly this pass) or
> **[HYPOTHESIS]** (plausible, needs investigation). Presence of a module is **not** evidence of
> completeness.

Product scope under review: **DORA Articles 28–30** (ICT third-party risk management), AI-assisted
analysis with governed human decisions.

## 1. Repositories

| Repo | Role | Evidence |
|---|---|---|
| `andrelair-platform/retrieva-backend` | Express 5 / Node 20 TS modular monolith + workers | this repo |
| `andrelair-platform/retrieva` | Next.js frontend (BFF) + Docusaurus docs (cert evidence home) | `../retrieva/frontend`, `../retrieva/docs` |

Both are member repos of the **Retrieva** product (GitHub Project board **#2**).

## 2. Backend surface — [CONFIRMED]

### 2.1 Feature modules (`modules/`) — extracted, high-cohesion
`amendments`, `arrangementAssessment`, `arrangements`, `completeness`, `concentration`,
`ddq-contradictions`, `decisionQueue`, `discovery`, `evaluations`, `evidence`, `exit-strategy`,
`intake`, `register`, `reportability`, `surveillance`.

### 2.2 Typed-in-place domains (`routes/` + `controllers/`) — not yet extracted
`auth`, `workspace`, `assessment`, `assessment-runs`, `approvals`, `rag`, `billing`, `questionnaire`
(+ public), `compliance`, `organization`, `conversation`, `health`, `publicEvidence`.

### 2.3 Mounted HTTP surface (`openapi/mounts.ts`, `app.ts`)
`/api/v1/`: `amendments · approvals · arrangement-graph · arrangements · assessment-runs · assessments ·
auth · billing · compliance · concentration · conversations · ddq-contradictions · decision-queue ·
discovery · evaluations · exit-strategy · organizations · public · questionnaires · rag · register ·
register-completeness · reportability · surveillance · workspaces`.

### 2.4 Background workers (`workers/`) — 6
`surveillanceWorker`, `questionnaireWorker`, `discoveryWorker`, `completenessWorker`,
`assessmentWorker`, `monitoringWorker`. Run as a separate process (`npm run workers`). They back the
**async "propose into an inbox"** pattern (API enqueues a job + returns `runId`; worker writes result +
inbox rows; UI polls).

### 2.5 Feature flags / env toggles — 11 [CONFIRMED]
`ASSESSMENT_RERANK_ENABLED`, `COMPLETENESS_SCHEDULE_ENABLED`, `CREW_A2A_ENABLED`,
`DISCOVERY_SCHEDULE_ENABLED`, `ENABLE_CHUNK_FILTER`, `ENABLE_CODE_FILTER`,
`ENABLE_CROSS_ENCODER_RERANK`, `ENABLE_VENDOR_RESEARCH`, `REPORTABILITY_FORMAL_CUTOVER`,
`SURVEILLANCE_ENABLED`, `SURVEILLANCE_SCHEDULE_ENABLED`.
→ **No central flag registry** exists; flags are read ad-hoc via `process.env`. [CONFIRMED gap]

## 3. Data layer — [CONFIRMED]

- **39 schema files** under `db/schema/` (Drizzle), incl. the ADR-0005 additions
  `reportabilityDeterminations.ts`, `cmdbAssetRefs.ts`, and the scope-adjacent `evaluations.ts`,
  `substituteProviders.ts`, `exitArtefacts.ts`.
- **35 migrations** (`db/migrations/`), latest **`0034_curly_maestro.sql`** (ADR-0005 A1).
- Append-only audit tables present: `actionAudit.ts`, `auditLog.ts`, `doraScoreHistory.ts`.
- Migration runs at container start (`db:migrate` → `db/migrate.ts`).

## 4. ADR-0005 / migration 0034 / reportability — LIVE VERIFICATION [CONFIRMED]

Queried the **dev** database (`retrieva-postgres-0`, ns `retrieva-dev`) this pass:

```
det_rows=24  arr_rows=24  legacy_backfill=24  system_proposed=24  cmdb_table_exists=t
reportability_status = legacy_assumed_reportable, pending_review, reportable, not_reportable
```

Interpretation:
- **1 determination per arrangement** (24↔24); all are `legacy_assumed_reportable` with
  `determined_by IS NULL` → the additive **system backfill** (append-only, no human attribution). ✅
- `cmdb_asset_refs` table present; enum complete. ✅
- **No human determinations exist yet** → the A3 determination API and the A5 reconciliation are
  **built but not yet exercised with real human decisions** (see findings doc). [CONFIRMED]
- **`REPORTABILITY_FORMAL_CUTOVER` is OFF (default)** → `buildRegister(org,{formal:true})` is the
  identity of the working register (code: `registerProjectionService.ts` only filters when
  `opts.formal && cutoverEnabled()`). The formal RT.02.01 export is therefore **byte-identical** to the
  working register today — **no change to Register semantics has shipped**. ✅

**Deployment state:** dev runs image `fad5cf4` (= latest `main`, all of A1–A5); pods
`retrieva-backend` + `retrieva-worker` Running 1/1.

## 5. Frontend surface (`retrieva/frontend/src/app`) — [CONFIRMED]

Route groups `(auth)` + `(dashboard)`. Dashboard routes map ~1:1 to backend modules:
`overview · arrangements[/id] · assessments[/id,/new] · assessment-runs · approvals · concentration ·
contract-amendments · ddq-contradictions→decision-inbox · discovery · evaluations[/id] · exit-strategy ·
questionnaires[/id,/new] · register-of-information · risk-register · surveillance · workspaces[/id] ·
chat · conversations[/id] · settings[/billing,/security,/team]`.
→ `chat`/`conversations` + `settings/billing` are **non-core** surfaces (see scope matrix).

## 6. Tests & CI — [CONFIRMED]

- **190 test files**: `tests/unittest` **149**, `tests/integrationtest` **40**, `tests/e2e` **1**.
- Scripts: `test` (vitest), `test:unit`, `test:integration`, `test:coverage`, plus AI-eval scripts
  (`evaluate:clause-mapping`, `evaluate:verdicts`) and seeds (`seed:ktayl-register`, `seed:is-evaluator`,
  `seed:compliance`, `seed:langfuse-prompts`).
- CI workflows: `ci.yml`, `build.yml`, `release.yml`, `bmad-sync.yml`.
- **[HYPOTHESIS]** Coverage of the ADR-0005 formal-split + the HITL contracts is partial — the A6 test
  story (`retrieva-backend#175`) is still open; the single `tests/e2e` file suggests **no full golden
  path** (discovery→…→register) is asserted end-to-end. Needs confirmation (P0-05, P2-01).

## 7. Open-issue landscape — [CONFIRMED]

- `retrieva` board #2: ~50 open issues; **majority are feature EPICs** (`RTV-*`: AgentOps, zero-touch
  intake, interoperability, self-hostable distribution, provider-type modules, …) → **defer** under the
  no-new-features constraint.
- `retrieva-backend`: A-stories `#170–#175` (ADR-0005 A1–A6) — **A1–A5 merged**, A6 (#175) open;
  new MCO issues **#184/#185/#186** (security review / regulatory sign-off / M2M Vault wiring).
- SaaS-feature issues to **freeze**: `#626, #627, #628, #443, #424, #420`.

## 8. What this baseline does NOT assert

Not audited deeply this pass (→ tracked as **[HYPOTHESIS]/investigation** in the backlog): per-endpoint
authorization correctness, multi-tenant isolation under adversarial input, worker idempotency/retry
semantics, RT.02.01 field-level validation against the EBA ITS, and AI extraction quality. Presence of a
control (e.g. `setEntityContext`, `can()`, `action_audit`) is noted as **evidence a control exists**, not
proof it is correct.
