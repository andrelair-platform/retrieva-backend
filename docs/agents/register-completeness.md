# Register-completeness agent (RTV-93)

Part of the **autonomous agents** on the AI-native TPRM roadmap (epic RTV-90). Where the **discovery
connectors** (RTV-91) *fill* the DORA Register of Information, the completeness agent **audits** it —
it scans the Register for **structural gaps** and raises **findings** into an inbox, so an incomplete
Register surfaces itself instead of failing silently at an ESA submission.

**Governance (same rule as discovery):** *audit & propose, never auto-fix.* The agent **never writes to
the Register** — it is read-only and deterministic. It produces findings; a human **acknowledges** or
**resolves** each one (after fixing the underlying record).

## What it checks

Deterministic rules over the Register snapshot (no LLM). Severity is **high** on critical/important
arrangements (and the proportionality gate itself), **medium** otherwise.

| Entity | Gap | Type |
|---|---|---|
| **Arrangement** | no criticality (CIF) — the proportionality gate (always high) · no dependency level · no exit-difficulty (critical/important only) · not linked to an ICT service · no data-residency · no data-classes | `missing_field` |
| **Business function** | supports a critical/important arrangement but **not flagged** critical-or-important | `inconsistent_flag` |
| **Legal entity** | no LEI · no country | `missing_field` |
| **Provider** (third-party) | no LEI (high if it serves a critical arrangement) | `missing_field` |
| **Provider** (third-party) | critical/important but **no nth-party (sub-chain) dependencies mapped** | `unmapped_subchain` |
| **Provider** (sub-chain edge) | a known nth-party dependency **not yet confirmed** by a human | `unconfirmed_subchain` |

**Not in this slice — contract expiry.** The arrangement model has no per-arrangement contract
start/end dates, so date-based *"expired contract"* detection is **deferred** (it would be a schema
change nobody populates yet). Contract-renewal / certification-expiry is already handled at the
workspace level by the **monitoring alerts** service (`alertMonitorService`). See *Deferred* below.

## Flow (async)

A scan touches every arrangement + dimension, so it runs as a **BullMQ job** off the request path (like
discovery): `POST …/run` enqueues it and returns `202 { runId }`; the **completeness worker** runs the
audit and persists the result to `register_completeness_runs` + the findings inbox
(`register_completeness_findings`), which you poll.

```
POST /run ─▶ register_completeness_runs (queued)  ─┐
                                                   ▼
               completeness worker (entity-scoped) ── loadSnapshot ── rules.auditRegister
                                                   ▼
               inbox diff: insert NEW findings · auto-resolve FIXED · (reopen reappearing)
                                                   ▼
               run → succeeded {scanned, gaps, newGaps, resolvedGaps, bySeverity}
```

The inbox is **idempotent**: a gap already open/acknowledged is not re-inserted; a gap that's since been
**fixed** (no longer in the scan) is **auto-resolved**; a previously-resolved gap that **reappears** is
reopened. So a daily re-audit is cheap and self-maintaining.

## Run

```bash
# 1. Trigger an audit → 202 { runId }.
curl -X POST https://<api>/api/v1/register-completeness/run -H "Authorization: Bearer <jwt>"
#   → { "ok": true, "data": { "runId": "…", "status": "queued", "poll": "/api/v1/register-completeness/runs/…" } }

# 2. Poll the run → summary + the findings it opened.
curl -H "Authorization: Bearer <jwt>" https://<api>/api/v1/register-completeness/runs/<runId>

# 3. The findings inbox across runs (filter by status / severity).
curl -H "Authorization: Bearer <jwt>" "https://<api>/api/v1/register-completeness/findings?status=open&severity=high"

# 4. Act on a finding (after fixing the record):
curl -X POST https://<api>/api/v1/register-completeness/findings/<id>/acknowledge -H "Authorization: Bearer <jwt>"
curl -X POST https://<api>/api/v1/register-completeness/findings/<id>/resolve     -H "Authorization: Bearer <jwt>"
```

### Endpoints

| Method + path | What |
|---|---|
| `POST /api/v1/register-completeness/run` | enqueue an audit → `202 { runId }` |
| `GET /api/v1/register-completeness/runs` | recent audits for the org |
| `GET /api/v1/register-completeness/runs/:id` | a run's summary + its findings |
| `GET /api/v1/register-completeness/findings?status=&severity=` | the findings inbox |
| `POST /api/v1/register-completeness/findings/:id/acknowledge` | mark a gap seen (still open) |
| `POST /api/v1/register-completeness/findings/:id/resolve` | close a gap (fixed) |

## Scheduling (repeatable · opt-in)

Besides the API trigger, the audit can run on a repeatable schedule. Opt in with env (off by default):

```
COMPLETENESS_SCHEDULE_ENABLED=true     # register the repeatable job (else it's removed on boot)
COMPLETENESS_SCHEDULE_HOURS=24         # interval (default 24h)
COMPLETENESS_SCHEDULE_ORG_ID=<org>     # the org to audit (system scope → whole org)
```

On the interval, a `completeness-scheduled-audit` job enqueues a **system-scope** audit for that org
(`workers/completenessWorker.ts → runScheduledAudit`). A system run has no user, so it scans the whole
org (a `readAcross` entity scope) rather than an empty default-deny one.

## Design (source-agnostic rails — mirrors discovery)

| File | Role |
|---|---|
| `services/completeness/types.ts` | the normalised snapshot shapes + `CompletenessFinding` |
| `services/completeness/rules.ts` | the pure gap rules (one per class) + `auditRegister` |
| `services/completeness/completenessService.ts` | orchestrator — `runCompletenessAudit` (dedup + tally); `findingKey` |
| `services/completeness/enqueue.ts` | create the run + add the BullMQ job (shared API + scheduler) |
| `config/queue.ts` · `types/jobs.ts` | the `completenessJobs` queue + `CompletenessJobData` |
| `workers/completenessWorker.ts` | the worker — entity scope, the inbox diff, audit (`processCompletenessJob` injectable) |
| `db/schema/registerCompletenessRuns.ts` · `registerCompletenessFindings.ts` | run-tracking + the findings inbox (+ enums) |
| `repositories/drizzle/CompletenessRepository.ts` | persistence + `loadSnapshot` (org + RTV-54 entity-scoped reads) |
| `modules/completeness/*` | `POST …/run` + the runs/findings polling + acknowledge/resolve |

Every collaborator (snapshot loader, repo, audit, worker handler, scope) is injectable, so the whole
flow unit-tests with no network, model, or DB (`tests/unittest/completeness{Rules,Service,Worker}.unit.test.ts`).
A non-dry audit writes one `completeness.audit.run` entry to the audit log (counts only, no PII).

## Deferred

- **Contract-expiry** — needs per-arrangement contract dates (schema change); covered today by the
  workspace-level monitoring alerts. Backfill when contract dates are added to the arrangement model.
- **Per-org schedule** — the schedule audits one configured org (same limitation as the discovery sweep).
