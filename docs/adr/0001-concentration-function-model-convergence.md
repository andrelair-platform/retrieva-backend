# ADR-0001 — Converge the concentration function model onto the entity-aware arrangement graph

- **Status:** Accepted — **DONE** (Phases 1–3 shipped; legacy `critical_functions` removed). Decisions 1–3 settled (see below).
- **Date:** 2026-10-23 (Phases 2–3 completed 2026-10-24)
- **Area:** Concentration / nth-party analysis (DORA Art. 28(4) / 29); RTV-15, RTV-54.
- **Supersedes nothing; sets up the retirement of the legacy `critical_functions` model.**

## Context

The product carries **two parallel "function" models**, built at different times:

| | `critical_functions` (concentration) | `business_functions` (register) |
|---|---|---|
| Scope | **org-level** (no `legal_entity_id`) | **entity-level** (`legal_entity_id` NOT NULL) |
| Criticality | `criticalityEnum` (critical/important) | `critical_or_important` boolean (+ arrangement `tier`) |
| Provider link | **manual** `critical_function_dependencies` (CF → workspace) | **derived** from arrangements (BF → arrangement → provider_node → workspace) |
| Authored via | the concentration UI (`POST /concentration/functions`) | the register/intake flow (arrangement intake, estate import, seed) |
| DORA-grounded | no (hand-linked) | yes (real contractual arrangements) |

`concentrationService` walks the **org-scoped** `critical_functions` graph, so it has **no legal-entity dimension**. That is why per-entity concentration (RTV-54) had to be delivered as a *bridge/proxy* (ADR context: PR #145, "Option A"): slice the concentration input to the provider set an entity's arrangements use (`arrangements.legal_entity_id → provider_nodes.workspace_id`), and approximate "the entity's CIFs" as *CIFs that touch those providers*. It works and needs no migration, but the CIF dimension is a proxy, and we maintain two function models.

## Decision

**Make `business_functions` the single function model for concentration too.** Concentration derives each function's provider dependencies from its **arrangements** (BF → arrangement → provider_node → workspace), weights by the **arrangement criticality** (`tier`), and gains per-entity concentration **natively** (filter `business_functions` by `legal_entity_id`). The legacy `critical_functions` + `critical_function_dependencies` tables and the manual function CRUD are then retired.

The pure scorer `computeConcentration({ providers, criticalFunctions, edges })` is **unchanged** — only the *input construction* moves from the manual CF model to the arrangement graph.

## Phased plan (safe, reviewable)

- **Phase 1 — additive builder (this PR; non-breaking).** New `buildConcentrationInputFromArrangements(org, legalEntityId?)` (+ `ArrangementRepository.listFunctionProviderEdges`) constructs the `computeConcentration` input from `business_functions` → arrangements → provider_nodes → workspaces + nth-party edges. Gated behind `CONCENTRATION_SOURCE=arrangements|legacy` (default **legacy** — nothing changes in prod). Unit-tested; prove on seed data.
- **Phase 2 — cut over + deprecate.** Flip the default to `arrangements`. Per-entity concentration goes native (replaces the Option-A proxy). Deprecate `POST /concentration/functions`; the concentration UI drops the create-function form and reads functions from the register. Route `getGraph` (viz) through the same builder.
- **Phase 3 — remove legacy (after bake).** Drop `critical_functions` + `critical_function_dependencies` + `CriticalFunctionRepository` + the frontend create-function UI. Data migration only **iff** Decision 1 says so.

## Open decisions — SETTLED (2026-10-24)

1. **Existing `critical_functions` data** — **no migration; treated as deprecated demo data.** Verified before dropping: dev had 1 orphan row / 0 dependencies, prod had 0 rows (the ktayl register seed uses `business_functions`). A real migration would have been lossy (a bare CF→workspace dependency cannot become a full arrangement, and CFs carry no entity); there was nothing worth migrating.
2. **Manual function CRUD** — **retired.** Concentration functions now flow only from the register's business functions + their arrangements; `POST`/`DELETE /concentration/functions` and the frontend authoring form are gone.
3. **Weighting** — **arrangement `tier`.** Per-function criticality = the **highest arrangement tier** it carries, falling back to `critical_or_important ? important : standard`.

## Consequences

- **Positive:** one function model; per-entity concentration becomes exact (not a proxy); the concentration graph is grounded in real arrangements; the legacy Mongoose-era `critical_functions` model and its hand-maintained dependency table are retired.
- **Negative / risk:** a data migration (if Decision 1 = migrate) is lossy and needs an entity-assignment rule; the manual authoring path goes away (Decision 2); the concentration UI changes in Phase 2.
- **Reversible until Phase 3:** the `CONCENTRATION_SOURCE` flag keeps both paths live through Phases 1–2; only Phase 3 is irreversible (table drop).

## References
- Option A (the bridge/proxy — superseded by the native per-entity slice, then removed in Phase 3): `ArrangementRepository.listProviderWorkspaceIdsByEntity` (retrieva-backend PR #145). The `scopeGraphToProviders` helper it used was deleted with the legacy path.
- Builder: `services/concentrationService.ts#buildConcentrationInputFromArrangements` + `ArrangementRepository.listFunctionProviderEdges`.
- Models (post-convergence): `db/schema/businessFunctions.ts`, `db/schema/arrangements.ts`, `db/schema/providerDependencies.ts`. (`db/schema/criticalFunctions.ts` removed in Phase 3 — migration `0029_red_ronan.sql`.)
