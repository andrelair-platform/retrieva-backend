# RT.02.01 reportability mapping review (ADR-0005 A4) — for owner sign-off BEFORE any cutover

> **Status: FOR REVIEW — NOT approved.** This is the regulatory field-mapping review the A4/A5
> determination (`docs/governance/adr-0005-a4a5-accepted-risk-determination.md`) requires **before** the
> formal RT.02.01 export may change. Nothing changes the formal output until the owner signs the block at
> the bottom **and** the A5 dry-run delta is reviewed + accepted. The cutover flag ships **OFF**.

## What changes (and what does NOT)
The EBA RT.02.01 templates and their **fields are UNCHANGED** — B_01 (entities), **B_02 (contractual
arrangements, one row per arrangement)**, B_03 (intra-group subset of B_02), B_05 (providers),
subcontracting. The cutover changes **only the ROW SET of B_02** (and therefore B_03/B_05 derived from it):
which arrangements are *included* in the formal submission. It is a **row-inclusion** change, not a
field remapping.

## Current behavior (cutover OFF — today)
B_02 includes **every** arrangement for the org, regardless of reportability or lifecycle — including
`prospect`/`due_diligence` (pre-contract) and `legacy_assumed_reportable` (the A1 migration bootstrap).
This is the known over-inclusion ADR-0005 was raised to fix.

## Proposed formal RT.02.01 inclusion criteria (cutover ON)
An arrangement is included in the **formal** export iff **BOTH**:
1. its **current reportability determination is human-`reportable`** (A3) — i.e. an authorized human
   confirmed a qualifying third-party ICT **service** arrangement; `not_reportable`, `pending_review`,
   and `legacy_assumed_reportable` are **excluded**; and
2. its **lifecycle is a contracted state** (`active`/`under_review`/`remediation`/`exiting`/`exited`) —
   i.e. **`prospect`/`due_diligence` (pre-contract) are excluded**.

The **internal working register** (`GET /api/v1/register`) is **unchanged** — it keeps showing *all*
arrangements (incl. prospect/pending/legacy) for the firm's own management + the review backlog.

## Regulatory basis (for the owner to confirm)
| Decision | Basis | Confirm |
|---|---|---|
| Include only human-`reportable` | ESMA/EIOPA: only a **qualifying third-party ICT service** arrangement belongs in the RoI; a licence-only/self-hosted asset with no ongoing ICT service does not (ADR-0005). | ☐ |
| Exclude `prospect`/`due_diligence` | RT.02.01 reports **contractual** arrangements; pre-contract pipeline is not a contractual arrangement. | ☐ |
| **Criticality is NOT an inclusion filter** | EBA: an ordinary qualifying arrangement enters the RoI **regardless** of critical/important-function support; CIF drives *additional* fields/due-diligence, **not** inclusion. (So the filter must NOT drop non-CIF arrangements.) | ☐ |
| `legacy_assumed_reportable` excluded until reviewed | A1 bootstrap is **not** a human determination; it must be reconciled (A5) → `reportable`/`not_reportable` before it counts. | ☐ |

## Impact (review via the A5 dry-run before deciding)
Run the A5 dry-run (`services/reportability/reconciliationService` / the reconciliation report): it shows,
**row by row**, which arrangements would be **added / removed / reclassified** in B_02 vs today, with the
reason (determination state / lifecycle) for each. The owner reviews that concrete delta here before cutover.

## Open regulatory questions for the owner
1. Should `exiting`/`exited` arrangements stay in the formal RT.02.01 (reporting continuity) or drop? (Proposed: **keep** — they were contractual.)
2. Are `legacy_assumed_reportable` rows to be excluded immediately at cutover (proposed: **yes**, pending reconciliation), or grandfathered for a window?
3. Confirm the B_05 provider set: providers of the *filtered* (reportable) arrangements only. (Proposed: **yes**.)

## Sign-off (owner — DO NOT pre-fill)
- Regulatory criteria above reviewed + correct: ☐
- A5 dry-run delta reviewed + acceptable: ☐
- **CUTOVER DECISION:** ☐ APPROVE cutover (flip `REPORTABILITY_FORMAL_CUTOVER` ON, per environment) · ☐ HOLD
- Reviewer / date: __________________

Until this block is signed APPROVE, the cutover flag stays **OFF** and the formal export is unchanged.
