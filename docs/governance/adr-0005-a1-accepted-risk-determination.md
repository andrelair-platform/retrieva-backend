# Accepted-risk determination — ADR-0005 / A1 (solo architecture/security self-review)

- **Linked design:** `docs/adr/0005-asset-service-reportability-classification.md` (Accepted 2026-10-27).
- **Scope of this determination:** **A1 ONLY** — additive schema design, **development** migrations,
  backward-compatibility mechanisms, and the associated automated tests. Nothing else.
- **Date:** 2026-10-27
- **Reviewer / risk-acceptor:** the project owner (**AndreLiar**), acting as SA + SEC. **This is an explicit
  owner self-review and accepted residual risk — NOT independent SA/SEC certification.**

## Verdict
**ADR-0005 / A1 — CONDITIONAL PASS (solo architecture/security self-review, independent assurance PENDING).**

## Independent assurance — NOT performed (transparent limitation)
ktayl is a **solo, synthetic** enterprise: there is no separate Security Engineer, Solution Architect, or
Compliance Officer. No independent security assurance has been performed on A1. Requiring a fictitious
reviewer would produce paperwork without real independent assurance; instead the owner self-reviews and
**explicitly accepts the residual risk**, with the compensating controls below and a hard reassessment
trigger. This record **must not** be presented as independent security/architecture certification, nor as
proof of DORA compliance for a real regulated financial institution.

## What is authorized
Begin **A1 only**: additive schema (service-relationship + reportability determination incl.
`legacy_assumed_reportable` + CMDB asset-reference), **dev** migrations + backfill, compatibility shims,
and tests. **A2–A6 are NOT authorized by this determination.**

## Conditions (binding on A1)
1. Reviewer + risk-acceptor = the project owner, recorded here as an explicit **self-review**.
2. The absence of independent security assurance is documented (above), with the solo-synthetic rationale.
3. Append-only audit history + existing tenant-isolation guarantees are preserved.
4. **No** production migration, **no** formal RoI export change, **no** change to regulated reporting behavior.
5. Backward compatibility maintained + a **tested** recovery/rollback plan.
6. This authorizes **A1 only** — A2–A6 may **not** be inferred from it.
7. **A4** (regulatory mapping) and **A5** (cutover) retain **separate explicit approval gates**.
8. **Reassessment required** before any of: real customer onboarding · real sensitive-data processing ·
   reliance on an external audit · a second engineer capable of independent review joining. At that point
   A1 (and the epic) get a real independent security/architecture + regulatory review.

## Compensating controls (for the accepted residual risk)
Additive-only migrations (reversible / tested rollback) · append-only determination + `action_audit`
history · tenant isolation (entityScope) retained · `legacy_assumed_reportable` kept **distinct** from
human-confirmed `reportable` (no silent conversion) · the A4/A5 release gates keep the formal RT.02.01
output unchanged until separately approved · full test matrix (parity, tenant, authz, history, rollback).

## Status
A1 implementation authorized **after this determination is committed**. Independent security + regulatory
review: **OUTSTANDING** (not completed). A2–A6 + A4/A5 gates: **not** cleared by this record.
