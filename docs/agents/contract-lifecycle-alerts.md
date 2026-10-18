# Contract lifecycle alerts

Autonomous monitors that warn **before a vendor contract locks you in** — the "Lifecycle Alerts" half of
Deep Contract Lifecycle & Clause Tracking. They run on the scheduled monitoring job
(`run-monitoring-alerts`, ~24h) in `services/alertMonitorService.ts`, email the workspace owners, and
dedupe (20h window). The clause-side of the feature is elsewhere: **extraction** = the CONTRACT_A30
assessment (`docs/agents/…`/gapAnalysisAgent), **redlining** = the amendment redliner
(`docs/agents/contract-redliner.md`).

## Renewal — notice-period aware

The lock-in point isn't the contract end date, it's the **notice deadline** = `contractEnd −
noticePeriodDays` (the last day to give termination notice). The monitor warns from **60 days before the
notice deadline** through to contract end:

- A vendor with a **90-day notice period** ending in 120 days is flagged **now** (the notice deadline is
  30 days out) — i.e. **months before lock-in**, not a flat 60-day-before-end heads-up.
- A vendor with **no `noticePeriodDays`** on record falls back to the legacy behaviour exactly (warn 60
  days before `contractEnd`).

The alert carries `noticePeriodDays`, `noticeDeadline`, `daysToNoticeDeadline`, and `pastNoticeDeadline`
(so the UI can escalate once the notice window has been missed).

## Price escalation

`priceReviewDate` is the next price-review / escalation date; the monitor warns **90 days ahead** of it so
a price increase never lands unseen. The structured `priceEscalation` terms —
`{ type: none | fixed_pct | cpi_linked, pct?, note? }` — ride along in the alert (`escalationType`,
`escalationPct`). Deterministic (no LLM): you record the clause terms, the monitor watches the date.

## Contract-evidence expiry

Complementary to the above, the register-completeness audit's `contract_expiry` rule
(`docs/agents/register-completeness.md`) flags an arrangement whose governing contract **evidence**
(`evidence.validityUntil`) is expired or lapsing — a per-arrangement register gap, distinct from these
per-vendor email nudges.

## Configure (per vendor — API)

`noticePeriodDays`, `priceReviewDate`, and `priceEscalation` are set on the vendor workspace via
`POST /api/v1/workspaces` / `PATCH /api/v1/workspaces/:id`:

```json
{ "contractEnd": "2027-01-31", "noticePeriodDays": 90,
  "priceReviewDate": "2026-07-01", "priceEscalation": { "type": "cpi_linked", "note": "CPI + 2%" } }
```

| Monitor | Lead | Source field |
|---|---|---|
| Renewal (notice-aware) | 60 days before the notice deadline | `contractEnd` − `noticePeriodDays` |
| Price escalation | 90 days before | `priceReviewDate` (+ `priceEscalation` terms) |

## Design + tests

| File | Role |
|---|---|
| `db/schema/workspaces.ts` | `noticePeriodDays` · `priceReviewDate` · `priceEscalation` (jsonb) |
| `services/alertMonitorService.ts` | `checkContractRenewal` (notice-aware) · `checkPriceEscalation` |
| `repositories/drizzle/WorkspaceRepository.ts` | `findByContractEndingSoon` · `findByPriceReviewSoon` |

Covered in `tests/unittest/alertMonitorService.test.js` (notice-aware window incl. the months-out case +
the not-yet case + the legacy no-notice fallback; price-escalation alert + dedup).

## Not in this slice

Per-contract *renewal lead* overrides (the 60/90-day leads are platform constants); auto-extracting the
notice period / price-escalation clause from the contract text (today they're recorded fields — the
CONTRACT_A30 extraction could populate them in a later slice); in-app (non-email) notifications.
