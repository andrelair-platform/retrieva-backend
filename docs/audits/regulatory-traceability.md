# Regulatory Traceability — Retrieva ↔ DORA Art 28–30

> Audit pass, 2026-10-29. Maps each in-scope DORA requirement to the responsible module, the implemented
> control, where evidence lives, the validation test, and the **human decision owner**. **Status** is the
> honest maturity, not aspiration: `Implemented` (code exists), `Integrated` (wired end-to-end),
> `Validated` (a passing test asserts it). A cell is only `Validated` with a named test.

Regulation: **DORA (Reg. (EU) 2022/2554) Art 28–30** + the ITS/RTS on the **Register of Information
(RT.02.01)**. Article mapping is to the base regulation; pin the applicable ITS version in `P0-06`.

| Req | DORA anchor | Module (responsible) | Implemented control | Evidence location | Validation test | Human decision owner | Status |
|---|---|---|---|---|---|---|---|
| R1 | Art 28(3) maintain Register of ICT arrangements | `register` | Register projected from graph on demand | `services/registerProjectionService.ts`, `config/register/rt0201FieldMap.ts` | ⚠️ structural only (`completeness`); **no field-level ITS conformance** | Risk/compliance owner | Implemented, **not Validated** (`P0-06`) |
| R2 | Art 28(3) RT.02.01 field conformance (B_01/B_02/B_03/B_05 + subcontracting) | `register`, `completeness` | Template field map + gap audit | `rt0201FieldMap.ts`, `modules/completeness` | ⚠️ needs pinned EBA ITS fixture | Compliance owner | **Investigate** (`P0-06`) |
| R3 | Art 28(3) correct inclusion/exclusion of entries | `reportability` | Tri-state determination + SoD, append-only; licence-vs-service + criticality-not-a-filter nuance | `modules/reportability`, `reportabilityDeterminations.ts`, ADR-0005, `docs/compliance/rt0201-reportability-mapping-review.md` | A1–A5 tests; **A6 suite open (#175)**; backfill verified live | **Human-only** (checker/admin); SERVICE hard-denied | Implemented + Integrated; **sign-off pending** (#185) |
| R4 | Art 28(4) pre-contractual risk assessment of ICT TPP | `evaluations` (assessment lane), `assessment`, `evidence`, `questionnaires` | DDQ scoring + evidence library + AI assessment (HITL) | `services/evaluation`, `assessmentRuns.ts`, `modules/evidence` | integration tests exist; grounding unverified | Analyst approves verdict | Implemented, partial Validated (`P2-02`) |
| R5 | Art 28(4) due-diligence quality (detect paper compliance) | `ddq-contradictions` | Answer-vs-own-evidence semantic cross-check → inbox (informs) | `modules/ddq-contradictions`, `ddqContradictions.ts` | ⚠️ precision/recall + citation grounding not asserted | Analyst ack/resolve | Implemented, **not Validated** (`P2-02`) |
| R6 | Art 28(7) ongoing monitoring of ICT TPP | `surveillance` | Feed collector raises events → inbox (never auto-rerate) | `workers/surveillanceWorker`, `surveillanceEvents.ts` | ⚠️ dedupe/triage/audit path untested | Analyst triage | Implemented, **not Validated** (`P2-05`) |
| R7 | Art 28(8) exit strategies for CIF arrangements | `exit-strategy` | Exit plan draft (CIF-gated) for risk-owner approval | `modules/exit-strategy`, `exitArtefacts.ts` | ⚠️ CIF-gating + approval path untested | Risk owner approves | Implemented; **enrichments adjacent** (`P1-02`) |
| R8 | Art 29 concentration-risk assessment (incl. subcontracting) | `concentration` | Concentration computed from provider graph incl. nth-party | `modules/concentration`, `providerDependencies.ts` | ⚠️ calc + subcontractor coverage unverified | Risk owner reviews | Implemented, **not Validated** (`P2-03`) |
| R9 | Art 30 mandatory contractual provisions | `amendments`, `arrangements` | Art-30 clause-gap detection → amendment **draft** (legal accepts/edits, never auto-apply) | `modules/amendments`, `contractAmendments.ts` | ⚠️ gap-detection + review path untested | Legal accepts | Implemented, **not Validated** (`P2-04`) |
| R10 | Cross-cutting: governed decisions + audit trail | `decisionQueue`/`approvals`, `action_audit` | Default-deny `can()`, SoD, append-only audit, tenant isolation | `config/authz/capabilities.ts`, `services/security/actionAudit.ts`, `setEntityContext` | ⚠️ adversarial isolation + `#156` fail-open untested | n/a (control plane) | Implemented; **Validate** (`P0-07`) |

## Reading of the matrix
- **Breadth is real:** every Art 28–30 obligation has a responsible module + an implemented control. This
  is the strong story for the certification (Bloc 2 — concevoir & développer).
- **Depth is the gap:** most rows are `Implemented`/`Integrated` but **not `Validated`** — i.e. a control
  exists in code but no test proves it satisfies the requirement. The honest certification line is:
  *"here is the control, here is the evidence it exists, here is the test gap I am closing."*
- **Two rows are regulatory-blocking for a real claim:** **R2** (RT.02.01 field conformance — the 6.5%
  pain) and **R3** sign-off (#185). These gate any statement that the Register is audit-ready.

## Decision-owner independence (SoD)
Per ADR-0004/0005: AI **proposes**; a **human decides**; and for reportability the proposer ≠ approver and
a SERVICE principal can never determine. The matrix's "human decision owner" column is the accountable
role — **not** the AI and **not** the service principal. Independent security + regulatory assurance of
this remains **outstanding** (#184, #185) and is not claimed complete.
