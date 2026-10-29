# Scope & Module Matrix — Retrieva

> Audit pass, 2026-10-29. Classifies every component against the target scope **(DORA Art 28–30,
> AI-assisted, human-governed)**. Decisions here are **recommendations for the consolidation backlog**,
> not applied changes. **No deletion/separation is executed in this pass** — each requires the
> dependency check in §4 first.

## Classification legend
- **Core** — core DORA capability → keep & harden
- **Support** — supporting infrastructure → maintain & secure
- **Adjacent** — scope-adjacent extension → isolate or defer
- **Freeze** — non-essential, parked (retain minimum for demo; no investment)
- **Investigate** — undetermined → requires investigation before a decision

## 1. Backend modules

| Component | Class | DORA anchor / role | Decision | Evidence |
|---|---|---|---|---|
| `discovery` | Core | Art 28(3) identification; proposes arrangements | Keep & harden | `modules/discovery`, `discoveryWorker`, `discoveryProposals.ts` |
| `intake` | Core | Onboard arrangement (confirm proposal) | Keep & harden | `services/intake/arrangementIntakeService.ts` |
| `evidence` | Core | Art 28(4) due-diligence evidence library | Keep & harden | `modules/evidence`, `evidence.ts`, `evidenceRequests.ts` |
| `arrangements` / `arrangementAssessment` | Core | Art 28(4)(5) + Art 30 contractual records | Keep; clarify ownership vs assessment | `arrangements.ts`, `arrangementProposals.ts` |
| `questionnaires` + `ddq-contradictions` | Core | DDQ + answer-vs-evidence contradiction | Keep & harden | `ddqContradictions.ts`, `questionnaireWorker` |
| `compliance` (ref library) | Core | Versioned DORA article references | Keep | `complianceRoutes`, `seed:compliance` |
| `concentration` | Core | **Art 29** concentration risk (incl. nth-party) | Keep; verify calc | `modules/concentration`, `providerDependencies.ts` |
| `reportability` | Core | RT.02.01 inclusion determination (ADR-0005) | Keep & prove | `modules/reportability`, verified §4 baseline |
| `register` / `completeness` | **Core (priority)** | **Art 28(3)** Register of Information | **Prove end-to-end** | `registerProjectionService.ts`, `completenessWorker` |
| `amendments` | Core | **Art 30** clause-gap redline (human-approved draft) | Keep | `contractAmendments.ts` |
| `surveillance` | Core | Art 28(1)(7) ongoing monitoring | Keep; verify dedupe | `surveillanceWorker`, `surveillanceEvents.ts` |
| `decisionQueue` / `approvals` | **Core (priority)** | The HITL gate across all modules | **Consolidate & standardise** | `modules/decisionQueue`, `approvalRoutes` |
| `evaluations` | **Adjacent** | Art 28(4) candidate risk-assessment ✅ **+ commercial ranking/selection ❌ (procurement)** | **Isolate** the ranking/selection; keep the risk-assessment | `services/evaluation/evaluationService.ts` ("compare candidates → select winner → promote"), `evaluations.ts` |
| `exit-strategy` | **Adjacent** | Art 28(8) exit plan ✅ **+ alt-provider matching & reintegration estimate ❌ (sourcing/capacity)** | **Trim**: isolate the enrichments; keep exit planning | `exit-strategy` header, `substituteProviders.ts`, `exitArtefacts.ts` |

## 2. Supporting infrastructure

| Component | Class | Decision | Evidence |
|---|---|---|---|
| `auth`, `organizations`, `workspaces` | Support | Audit authz/tenancy/roles (do not expand) | `authRoutes`, `roleAssignments.ts`, `setEntityContext` |
| `rag`, `conversations` (chat) | Support | Keep AI grounding/traceability; **do not grow a 2nd product experience** | `ragRoutes`, `conversationRoutes` |
| `assessment` / `assessment-runs` + `assessmentWorker` + `CREW_A2A` | Support/Core | AI assessment engine for the Core modules | `assessmentRuns.ts`, `assessmentRunApprovals.ts` |
| `monitoringWorker`, observability (`instrument.js`, Langfuse) | Support | Maintain & secure | `instrument.js`, `seed:langfuse-prompts` |

## 3. Freeze / defer (no investment this phase)

| Item | Class | Decision |
|---|---|---|
| `billing` (Stripe), `settings/billing` | Freeze | Retain only what the demo needs; no work. Evidence: `billingRoutes`, Stripe webhook handler |
| `public` / `publicEvidenceRoutes` / `questionnairePublicRoutes` | Investigate→Support | External surfaces → **security review before anything else** |
| Open feature EPICs on board #2 (AgentOps #666/#669/#670, zero-touch #611, interoperability #615, self-hostable #518, provider-type modules #504, change-impact #503, …) | Defer | No new features this phase |
| SaaS issues #626 (customer SSO), #627 (public API keys), #628 (copilot cost model), #443 (workspace MFA), #424 (multilingual KB), #420 (i18n reports) | **Freeze** | Explicitly out of Art 28–30 scope |

## 4. Mandatory dependency check before ANY separation/removal

> No component above is deleted or physically separated in this pass. Before a later PR isolates
> `evaluations`-ranking or the `exit-strategy` enrichments, record for each:

1. **Active consumers** — frontend routes (`evaluations[/id]`, `exit-strategy`), API callers, the IS
   service-principal dogfood (ADR-0004 uses `evaluations`).
2. **Persisted data** — `evaluations.ts`, `substituteProviders.ts`, `exitArtefacts.ts` rows in dev/prod;
   `cmdbAssetRefs` is written by `selectWinner` (internal-only outcome) — **evaluation is load-bearing for
   the asset-vs-service branching**, so it cannot simply be removed.
3. **Migrations** — any FK from core tables to the adjacent tables (check `relations.ts`).
4. **Tests** — which suites assert the adjacent behaviour.

**Recommended separation technique = feature-flag isolation, not deletion.** Gate the commercial
ranking/selection and the exit enrichments behind a flag (default OFF in the demo profile), exactly as
`REPORTABILITY_FORMAL_CUTOVER` isolates the formal register. This preserves data + API compatibility and
is fully reversible — see consolidation-backlog `P1-01`/`P1-02`.

## 5. Decision summary

- **Keep & harden:** 11 core modules + the HITL layer.
- **Prove (priority):** register/completeness end-to-end; decisionQueue/approvals consolidation.
- **Isolate (adjacent, flag-gated, deferred):** `evaluations` commercial ranking; `exit-strategy`
  alt-provider matching + reintegration.
- **Freeze:** billing + 6 SaaS issues.
- **Investigate first:** public external surfaces.
