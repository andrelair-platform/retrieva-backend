# ADR-0005 — ICT Asset vs Third-Party ICT Service Relationship classification & DORA RoI reportability

- **Status:** **Accepted — DECISIONS RESOLVED 2026-10-27 (owner-delegated review); DOCUMENT ONLY, build
  not yet started.** The five open decisions are resolved below. The data-model build itself (schema +
  migration + code) remains a **separate Path-C effort** gated on its own architecture + security +
  compliance review; this ADR is the agreed design, amendable.
- **Date:** 2026-10-27
- **Area:** Domain model (third-party ICT register), DORA Art. 28–30 Register of Information (RT.02.01)
  reportability, evaluation→promotion lifecycle, CMDB integration boundary. **Dev-first.**
- **Builds on:** ADR-0001 (concentration function model — `business_function → arrangement`) · ADR-0002
  (tool-onboarding / software-evaluation → promotes a winner to an arrangement) · ADR-0004 (the IS M2M
  tenant that *injects* evaluations). Platform: `minicloud-gitops/.claude/rules/software-evaluation.md`.
- **Regulatory basis:** ESMA/EIOPA DORA Q&A — *supplying a software licence without ongoing ICT services
  does not, by itself, make the supplier an ICT third-party service provider*; the reporting boundary is
  **the existence and nature of an ICT service supplied by a third party**, NOT where the software runs.

## Context — the verified gap (read-only investigation, 2026-10-27)

Retrieva currently cannot distinguish an **internal ICT asset** from a **third-party ICT service
arrangement**, and it reports *everything* it tracks into the DORA RoI. Verified end-to-end:

- `services/evaluation/evaluationService.ts` → **`selectWinner()`** unconditionally calls
  `confirmProposal({trigger:'new'})` after a human selects a candidate — **no asset-vs-service step**.
- `services/intake/arrangementIntakeService.ts` → **`confirmProposal()`** **always** `arrangements.create()`;
  provider is **always** `kind:'external'`; `arrangement_type ∈ {external, intra_group}` (intra-group
  *structure*, not asset-vs-service); `ict_service_id` is **nullable**.
- `db/schema/enums.ts` → the only type axes are `arrangement_type` (external/intra_group) and
  `ict_services.service_type` (null/cloud/software/data/network/other — a *kind* taxonomy). **Grep for
  `roi_eligible|reportable|is_service|service_relationship|ict_asset|ongoing.service` → empty.**
- `services/registerProjectionService.ts` → **`buildRegister()`** = `arrangementRepository.listByOrg()`
  (`ArrangementRepository.ts:59` — org + entity scope only, **no lifecycle/type/reportability filter**) →
  `services/registerProjection.ts` maps **every** arrangement (incl. `prospect`) to an RT.02.01 B_02 row.

**Classification of the gap:** a **confirmed structural + behavioral modeling gap**, but **latent** — the
seeded/real data (`seedKtaylRegister`: AWS/Cloudflare/GitHub/Azure/GCP/OCI/Anthropic/Tailscale/Stripe) is
all genuine third-party ICT services, so nothing is *currently* mis-registered. The defect **manifests the
moment a self-hosted-no-service / licence-only tool is onboarded** → it becomes an `external` arrangement →
RT.02.01 → **over-registration** (the ESMA-flagged error). Separately, `prospect` (pre-contract)
arrangements appear in the RoI — a **distinct lifecycle concern** (§7), not asset-vs-service.

> **Business-value guardrail (scope discipline).** Retrieva's value is the **defensible graph** linking
> ICT services → contracts → business functions → risk → evidence → decisions — **not** being a CMDB. This
> ADR *sharpens* that graph (adds the reportability determination it was missing); it must **not** expand
> Retrieva into general IT asset management. Asset inventory + SBOM stay in GLPI/CMDB (#16) + Trivy/cosign.

## Decision — four separated concepts + a reviewed tri-state determination

Introduce an explicit separation (requirement 1), **non-exclusive** (requirement 2):

| Concept | What it is | Home |
|---|---|---|
| **A. ICT asset identity** | the software/system the firm runs (community GLPI, a licence) | **external CMDB reference (GLPI)** — a *pointer* in Retrieva, not a rebuilt inventory (req 7, 10) |
| **B. Third-party ICT service relationship** | a third party *provides an ongoing ICT service* (SaaS / managed / support-&-maintenance) | a classified relationship in Retrieva carrying the determination (D) |
| **C. Contractual arrangement** | the DORA fact `LegalEntity × BusinessFunction × Provider/Service` | the **existing `arrangements`** model — created **only** when a qualifying B exists (req 6) |
| **D. RoI reportability determination** | the **reviewed** regulatory decision | tri-state on B/C (below) |

### D1 — the tri-state determination (requirement 3)
`pending_review | reportable | not_reportable`:

| Status | Meaning | Formal RT.02.01 export |
|---|---|---|
| `pending_review` | classification not yet confirmed / insufficient evidence | **Excluded, surfaced as a completeness gap** |
| `reportable` | a qualifying third-party ICT **service** arrangement | **Included** |
| `not_reportable` | no qualifying third-party ICT service (internal asset / licence-only) | **Excluded** |

### D2 — determination is REVIEWED, never auto-derived (requirements 4, 5)
A **service-relationship classification** (`none | licence_only | support_maintenance | managed_service |
saas`) may *propose* a reportability value, but **reportability is NOT derived solely** from hosting model,
`arrangement_type`, `service_type`, or `lifecycle` (req 5). An **authorized human** confirms it against the
applicable regulatory criteria. Every determination **and every override** records: **rationale · linked
evidence · approver identity · timestamp** (req 4) — append-only, reusing the ADR-0004 `action_audit`
pattern + the existing `evidence`/`evidenceRequests` tables.

### D3 — promotion branches on whether a qualifying service exists (requirements 6, 7)
`selectWinner()` / `confirmProposal()` gain a classification step:
- **Qualifying third-party ICT service** (SaaS/managed/support) → create an **arrangement** as today, with a
  reportability determination initialized to **`pending_review`** (or a classification-proposed value) —
  never silently `reportable`.
- **Internal-only asset** (no qualifying service) → **do NOT create an arrangement** and **do NOT fabricate
  an `external` provider** (req 6). Instead a **lightweight evaluation outcome** records the decision + an
  **external CMDB asset reference** (req 7) → tracked, risk-assessable, **not** in RT.02.01.
- A software may yield **both** (req 2): an asset reference **and** one or more third-party service
  arrangements (e.g. self-hosted GLPI **+** an external managed-support contract).

### D4 — working register vs formal RoI export (requirement 9)
Split the two reader needs explicitly:
- **Internal working register** — the full tracked graph (all arrangements incl. `prospect`, `pending_review`)
  for the firm's own management. Today's `GET /api/v1/register` ≈ this.
- **Formal regulatory RT.02.01 export** — filters to `reportable` **and** (separately governed) a
  contract-lifecycle gate. The **`prospect`-in-RoI question is recorded as its own governed decision**
  (does a formal submission include pre-contract prospects? default proposal: **no**) — decided separately,
  not bundled into the asset-vs-service change.

## Scenario acceptance (the five from the investigation)

| Scenario | Expected determination | Formal RoI |
|---|---|---|
| Community GLPI, self-hosted, **no** external service | asset reference; **`not_reportable`** (no arrangement) | **Excluded** |
| GLPI self-hosted **+** external managed support | asset reference **+** arrangement for the support service; `pending_review → reportable` | **Included** (the service) |
| Microsoft 365 SaaS | arrangement; `reportable` | **Included** |
| Perpetual licence, **no** ongoing service | asset reference; **`not_reportable`** (contractual facts reviewed) | **Excluded** |
| Self-hosted **+** ongoing vendor patches/support | arrangement; **`pending_review`** → reviewer decides if the ongoing service qualifies | reviewed, not automatic |

## Authorization & audit requirements
- Setting/overriding a determination requires an **authorized reviewer** (a capability, e.g.
  `reportability:determine` — gated by the ADR-0004 `can()` map; a **SERVICE principal must NOT** set it,
  consistent with SoD §1b of ADR-0004).
- Every determination/override → append-only record (rationale, evidence refs, approver, timestamp).
- The determination history is immutable and survives principal disable (ADR-0004 pattern).

## Backward compatibility, migration & cutover (requirement 8)
**Do NOT silently mark all legacy arrangements `reportable`.** Instead:
1. **Introduce a `legacy_assumed_reportable` state** (distinct from reviewed `reportable`) for all existing
   arrangements at migration → **current RT.02.01 export is byte-unchanged** (legacy-assumed is exported,
   preserving today's behavior + all data + audit history).
2. **Reconciliation pass** — a review queue surfaces every `legacy_assumed_reportable` for an authorized
   reviewer to confirm → `reportable` or re-classify → `not_reportable` (demoting it from the formal export,
   with rationale). Powered by the existing `registerCompleteness` engine as gaps.
3. **Cutover gate** — the formal export only *changes* (starts excluding legacy-assumed) after an explicit,
   owner-approved cutover; until then legacy-assumed == exported. No row is ever deleted; demotion is a
   reversible, audited state change.

## Affected components (no change made yet — for the build phase)
- **Schema:** a reportability determination + service-relationship classification + an asset-reference
  concept (exact shape = build-phase decision; candidates below). Migrations additive + backfill to `legacy_assumed_reportable`.
- **Services:** `evaluationService.selectWinner`, `arrangementIntakeService.confirmProposal` (the branch),
  `registerProjection(.Service)` / `registerExportService` (the `reportable` filter + working-vs-formal split),
  `completeness/*` (the review-queue gaps).
- **API:** `modules/register/*` (formal vs working), a determination endpoint (authorized).
- **Integration:** a GLPI/CMDB asset-reference connector (pointer only).

## Implementation alternatives (for review)
- **Alt-1 (recommended): determination on a service-relationship entity.** A distinct relationship carries
  classification + tri-state; an `arrangement` is created only for a qualifying relationship. Cleanest
  separation (A/B/C/D), most faithful to DORA; largest change.
- **Alt-2 (lighter): determination columns on `arrangements`** (`reportability_status`, `service_relationship`,
  `+ determination audit`), plus "internal-only → evaluation outcome + CMDB ref, no arrangement." Less
  normalized but smaller; risks overloading the arrangement fact.
- **Alt-3 (minimal): a reportability filter only** on the export + a manual flag. Fastest, but does **not**
  separate asset identity (req 1) — rejected as it re-creates the conflation under a flag.

## Security / regulatory risks
- **Over-registration** (current) — reporting non-third-party-service items in RT.02.01 (false regulatory record).
- **Under-registration** (new risk if mis-reviewed) — a reviewer wrongly marks a genuine service `not_reportable`
  → a real third-party dependency missing from the RoI. Mitigation: `pending_review` default + audit + the
  completeness gap + 4-eyes on demotions.
- **Migration regression** — silently changing the export. Mitigation: `legacy_assumed_reportable` + explicit cutover gate.
- **Scope creep** — Retrieva drifting into CMDB. Mitigation: asset = external GLPI reference only.

## Resolved decisions (2026-10-27, owner-delegated review)
1. **Model shape → Alt-1 (separate service-relationship entity).** Keep the `arrangements` fact clean; a
   distinct relationship carries the service classification + the tri-state determination, and an
   `arrangement` is created only for a *qualifying* relationship. Faithful to DORA's separation + enables
   the non-exclusive asset+service case; the extra normalization cost is accepted over re-overloading the
   arrangement (Alt-2). Asset identity stays a **CMDB reference** (not a Retrieva entity).
2. **`prospect` in the formal RoI → EXCLUDE.** RT.02.01 is a submission of *contractual* arrangements, so
   pre-contract `prospect`/`due_diligence` are excluded from the **formal export** but remain in the
   **internal working register** (the §D4 working-vs-formal split). Governed separately, as agreed.
3. **Classification → PROPOSE, land as `pending_review`.** The AI/classification *auto-proposes* a
   reportability value **with rationale + confidence** (don't waste the AI signal), but it is applied only
   as **`pending_review`** awaiting an authorized human confirm — never auto-`reportable`. Exactly the
   ADR-0006 copilot-first / human-gated pattern; the proposer ≠ the approver (ADR-0004 SoD).
4. **Asset-reference depth → CMDB id/URL + a MINIMAL cached descriptor** (name, type, owner) for display +
   reasoning, refreshed from GLPI. Not a rebuilt inventory; GLPI/CMDB remains the asset system of record.
5. **Legacy cutover → time-boxed reconciliation window, export unchanged until an explicit owner cutover.**
   Do NOT block on 100% reconciliation (too rigid); `legacy_assumed_reportable` keeps exporting as today,
   the unreconciled count is a completeness metric, and the owner triggers the cutover when comfortable.

(These are the agreed design; ADR-0006 governs the orchestration/HITL that *drives* determination #3.)

## Consequences
Retrieva gains the **reviewed reportability determination** DORA actually requires, stops auto-registering
self-hosted/licence-only tools, and keeps its graph defensible — while **not** becoming a CMDB. Cost: a
review step + a migration/reconciliation. This is **BC02/BC03** cert evidence (compliance-by-design).

Related: ADR-0001, ADR-0002, ADR-0004, `minicloud-gitops/.claude/rules/software-evaluation.md`,
`platform-vs-information-system.md`, `[[project_retrieva_is_service_principal]]`,
`[[project_retrieva_tool_onboarding]]`, `[[reference_dora_market_validation]]`.
