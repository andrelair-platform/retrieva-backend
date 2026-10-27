# Accepted-risk determination — ADR-0005 / A2 (solo architecture/security self-review)

- **Linked design:** `docs/adr/0005-asset-service-reportability-classification.md` · **A1 predecessor:**
  `docs/governance/adr-0005-a1-accepted-risk-determination.md` (merged #176; A1 dev-verified 2026-10-27,
  all 8 gates pass).
- **Scope:** **A2 ONLY** — the evaluation→promotion branching (`selectWinner`/`confirmProposal`) + its tests.
- **Date:** 2026-10-27
- **Reviewer / risk-acceptor:** project owner (**AndreLiar**), SA + SEC. **Explicit owner self-review +
  accepted residual risk — NOT independent SA/SEC certification.** Granted as a **CONDITIONAL GO effective
  only after all A1 dev-verification gates passed** (they did).

## Verdict
**ADR-0005 / A2 — CONDITIONAL PASS (solo self-review, independent assurance PENDING).**

## Independent assurance — NOT performed
Solo synthetic environment; no independent SEC/SA. Owner self-reviews + accepts the residual risk with the
controls below + the reassessment trigger. Not independent certification; not proof of DORA compliance for
a real FI.

## What is authorized (A2 only)
The promotion branch per ADR-0005 §D3: an evaluation outcome may create an **internal ICT asset reference**,
a **third-party ICT service arrangement**, or **both** (non-exclusive). Dev-only, additive.

## Conditions (binding on A2)
1. **Non-exclusive** — an evaluated solution may be both an ICT asset AND associated with third-party ICT service(s).
2. **Internal-only outcomes create NO fictitious provider or arrangement** — only a CMDB asset reference + the evaluation outcome.
3. **Third-party-service outcomes may create an arrangement**, which lands with a **`pending_review`** reportability determination (system-proposed, determinedBy NULL — a human decides later in A3; never auto-`reportable`).
4. Preserve **evaluation history**, **human-only `evaluation:select`** authorization (no new bypass route; SERVICE principals still cannot select — ADR-0004 SoD), **tenant isolation**, and **attributable audit** records.
5. **No change to the formal RoI export** behavior in A2.
6. Migrations **additive**; backward compatibility tested (existing selectWinner/intake still works).
7. **Not** authorized: A3–A6, Epic B, production changes, Vault provisioning. **A4/A5 retain separate gates.**
8. Reassessment required before real customers / real sensitive data / external-audit reliance / a second engineer (independent review).

## Compensating controls
SoD guard (service cannot select) unchanged · determinations land `pending_review` (no auto-reportable) ·
append-only determination + action_audit · tenant-scoped rows · the current RoI export untouched (A1 parity
holds; A2 adds no export read) · full test matrix incl. the 5 scenarios + mixed + no-fake-provider + backward-compat.

## Status
A2 implementation authorized after this determination is committed. Independent security + regulatory review:
**OUTSTANDING**. A3–A6 + A4/A5: **not** cleared.
