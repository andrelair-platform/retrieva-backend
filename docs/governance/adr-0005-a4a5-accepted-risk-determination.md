# Accepted-risk determination — ADR-0005 / A4 + A5 (solo self-review) — BUILD ONLY, cutover NOT granted

- **Linked design:** `docs/adr/0005-asset-service-reportability-classification.md` · predecessors A1/A2/A3 (merged).
- **Scope:** **A4 (working-vs-formal register split) + A5 (dry-run reconciliation + the cutover mechanism)** —
  **BUILD ONLY, behind a cutover flag that DEFAULTS OFF.** This determination does **NOT** authorize the
  cutover itself (changing the formal DORA RT.02.01 output).
- **Date:** 2026-10-28
- **Reviewer / risk-acceptor:** project owner (**AndreLiar**). Solo self-review; independent SA/SEC **and**
  the regulatory-reporting sign-off are **PENDING** (not performed). Not DORA compliance for a real FI.

## Verdict
**A4+A5 BUILD — CONDITIONAL PASS (solo self-review).** The **cutover is a SEPARATE, explicit owner decision**
(below), gated on the regulatory field-mapping review — NOT cleared by this record.

## The two-part gate (this is the whole point of A4/A5 being release gates)
- **AUTHORIZED now (safe, reversible, dev-only):** build the register **split** (an internal *working
  register* = all arrangements; a *formal RT.02.01 export* path) and the **dry-run reconciliation**
  (row-level diff of current vs proposed formal export), **all behind a cutover flag `REPORTABILITY_FORMAL_CUTOVER`
  that DEFAULTS OFF**. Flag OFF ⇒ the formal export is **byte-identical to today** (export parity). No
  regulated-output change. This may be built, tested, and merged under this determination.
- **NOT authorized (the owner's separate call):** flipping the cutover flag ON — i.e. changing which
  arrangements appear in the formal **RT.02.01** (filter to human-`reportable` + exclude `prospect`). That
  requires (a) the **regulatory field-mapping review** (delivered for review as
  `docs/compliance/rt0201-reportability-mapping-review.md`) signed off, and (b) an **explicit owner cutover
  approval** taken AFTER reviewing the A5 dry-run diff. Until both, the flag stays OFF in every environment.

## Conditions (binding)
1. Cutover flag **defaults OFF**; flag-OFF formal export is **byte-identical** (a parity test enforces it).
2. The **working register** (all arrangements, incl. `prospect`/`pending_review`/`legacy_assumed_reportable`)
   is distinct from the **formal export**; building the split changes NO output while the flag is OFF.
3. The **dry-run** is read-only (row-level added/removed/reclassified) and has **no side effects**; it does
   **not** flip the cutover.
4. **No cutover without** the regulatory field-mapping sign-off **and** an explicit, recorded owner approval
   taken after the dry-run. The flag is not flipped in prod or dev by this work.
5. Additive; append-only determinations (A3) are the only reportability source the formal filter reads.
6. **Not** authorized: the cutover, A6 beyond its own tests, Epic B, production changes, Vault.
7. Reassessment before real customers / real sensitive data / external-audit reliance / a second engineer.

## Compensating controls
Cutover flag default-OFF + a parity test (formal export unchanged) · dry-run is read-only · the filter reads
only human determinations (A3) · reversible (flag OFF restores current) · the regulatory mapping is an
explicit reviewable artifact, not an implicit code decision.

## Status
A4/A5 **build** authorized after commit. **Cutover: OUTSTANDING** (needs regulatory sign-off + owner
approval after the dry-run). Independent security + regulatory review: **OUTSTANDING**. A6/Epic B/prod/Vault: not cleared.
