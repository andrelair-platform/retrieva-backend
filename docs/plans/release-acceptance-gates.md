# Release Acceptance Gates — Retrieva consolidation

> Audit pass, 2026-10-29. The conditions under which the consolidation phase is "done". These are
> **proposed gates, not claims the system passes them today** — most map to open backlog items. A gate is
> only green with **named evidence** (a passing test, a signed-off doc, a verified live check). Nothing is
> marked passed by inference.

## Gate set

| # | Area | Gate | Evidence required | Backlog | State |
|---|---|---|---|---|---|
| G1 | Scope | Every active module has a documented purpose + owner; adjacent logic is flag-isolated (default OFF in demo) | baseline §2 + scope matrix + P1-01/02 flags present | P1-01, P1-02, P0-01 | ⛔ open |
| G2 | Data integrity | No unexplained inconsistency across authoritative records ↔ register projection; every arrangement has ≥1 determination | P2-01 golden path + a data-integrity assert | P0-05, P2-01, P2-07 | ⛔ open |
| G3 | Regulation | Art 28–30 requirements mapped to controls + **passing** evidence; RT.02.01 field conformance test green; reportability mapping **signed off** | traceability matrix all rows ≥Integrated; P0-06 green; #185 sign-off | P0-06, #185 | ⛔ open (regulatory-blocking) |
| G4 | Security | No unresolved critical/high access-control or tenant-isolation defect; `#156` fail-open fixed | P0-07 isolation suite green; independent review #184 | P0-07, #184 | ⛔ open |
| G5 | AI governance | No regulated decision is silently applied by an AI/SERVICE principal | SERVICE hard-deny test + propose→human-decide contract tests | P1-06, (reportability tests present) | 🟡 partial (control verified in code; contract test pending) |
| G6 | Reliability | Critical golden paths pass incl. expected failure (AI-down, worker crash) | P2-01 + P2-06 green in CI | P2-01, P2-06 | ⛔ open |
| G7 | Operations | Deployment, rollback and DB restore exercised; runbooks exist | P2-07 restore drill + P3-04 runbooks | P2-07, P3-04 | ⛔ open |
| G8 | Product demo | A complete, repeatable demo runs with **no manual DB intervention** | P3-02 seed + a scripted demo run | P3-02 | ⛔ open |
| G9 | Register semantics | The formal RT.02.01 cutover is flipped **only** after mapping sign-off + a live dry-run reconciliation | #185 sign-off + #174 dry-run evidence; flag flip is a logged owner decision | #174, #185 | ⛔ owner-gated (flag OFF today — parity holds) |

## Gate dependencies
`G3` and `G4` are **regulatory/security-blocking** — no "audit-ready" claim without them. `G9` (cutover)
is **downstream of G3** and is an explicit **owner decision**, never automated. `G2`/`G6` depend on the
golden-path (P2-01) which depends on the P0 chains.

## Confirmed-today (green) baseline facts (evidence, not inference)
- ADR-0005/migration 0034 deployed correctly on dev; backfill append-only; `cmdb_asset_refs` present
  (baseline §4 live SQL).
- Cutover flag OFF ⇒ formal register == working register (code + flag state) → **G9 safe to leave as-is**.
- AI→human decision boundary present + SERVICE hard-deny in code (findings §4) → partial G5.
- Dev running latest `main` (`fad5cf4`), pods healthy.

## Explicitly NOT claimed
Independent **security** (#184) and **regulatory** (#185) assurance are **outstanding**; no gate is marked
passed on the strength of self-review. Efficiency/time-saved numbers are **hypotheses** until P3-06
benchmarks them. The adjacent-scope separations (P1-01/02) are **planned, reversible, not yet applied**.

## Exit definition
Consolidation is complete when **G1–G8 are green with named evidence** and **G9 is a consciously-made,
logged owner decision** (flip or stay-parity). Until then the product is "broad and coherent, depth-in-
progress" — which is the honest status to present for certification.
