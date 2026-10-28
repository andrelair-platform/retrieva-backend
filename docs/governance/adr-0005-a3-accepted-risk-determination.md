# Accepted-risk determination — ADR-0005 / A3 (solo architecture/security self-review)

- **Linked design:** `docs/adr/0005-asset-service-reportability-classification.md` · predecessors:
  `adr-0005-a1-accepted-risk-determination.md` (merged, dev-verified) · `adr-0005-a2-accepted-risk-determination.md` (merged).
- **Scope:** **A3 ONLY** — the reportability **determination API + authorization** (human-only, SoD) + its tests.
- **Date:** 2026-10-28
- **Reviewer / risk-acceptor:** project owner (**AndreLiar**), SA + SEC. **Explicit owner self-review +
  accepted residual risk — NOT independent SA/SEC certification.** A3 is a **security-boundary change**
  (authorization for a *regulated* determination), so this record is the governance gate for it, cleared
  solo.

## Verdict
**ADR-0005 / A3 — CONDITIONAL PASS (solo architecture/security self-review, independent assurance PENDING).**

## Independent assurance — NOT performed
Solo synthetic environment; no independent SEC/SA. This is the highest-sensitivity A-story (it decides
*who* may write a regulated reportability determination), so the limitation is stated plainly: the authz
model + threat surface are **owner self-reviewed**, not independently assured. Not DORA compliance for a real FI.

## What is authorized (A3 only)
A **determination endpoint** that lets an **authorized human** set/override a reportability determination
(`reportable` / `not_reportable`) with rationale + evidence; append-only + audited; dev-only, additive.

## Conditions (binding on A3)
1. **Human-only.** Writing a determination requires the capability **`reportability:determine`**; a
   **SERVICE principal is DENIED** (ADR-0004 `principalType` guard → 403), even with a broad/inherited grant.
2. **Separation of duties.** The proposer ≠ the approver: an AI/system `pending_review` proposal (A2) can
   never be the human decision; the decision is a distinct, human-authored row.
3. **No auto-`reportable`.** The endpoint is the ONLY path from `pending_review`/`legacy_assumed_reportable`
   to a human-confirmed `reportable`/`not_reportable`; nothing else flips it.
4. **Append-only + audited.** Each determination is a new immutable row (rationale · evidence refs ·
   approver identity + role · UTC timestamp) + an `action_audit` entry (allow/deny); no update/delete.
5. **Tenant isolation** (entityScope) enforced on reads/writes; a determination is org-scoped.
6. **No change to the formal RoI export** in A3 (that is A4/A5).
7. Migrations additive (A3 expects none — the A1 schema suffices); backward compatibility tested.
8. **Not** authorized: A4–A6, Epic B, production changes, Vault provisioning. **A4/A5 retain separate gates.**
9. Reassessment required before real customers / real sensitive data / external-audit reliance / a second
   engineer (independent review) — **especially** for this authz boundary.

## Compensating controls
Capability-gated + principal-type hard guard (defense in depth) · proposer≠approver · append-only
determination + action_audit · tenant-scoped · RoI export untouched (A1 parity holds) · authz test matrix
(human-allowed / unauthorized-human-denied / SERVICE-denied) + append-only + tenant tests.

## Status
A3 implementation authorized after this determination is committed. Independent security + regulatory
review: **OUTSTANDING**. A4–A6 + A4/A5 gates: **not** cleared.
