# Contract-amendment redliner (RTV-97/98)

**Pillar 6 of the AI-native roadmap — close the loop from finding to fix.** The DORA Article 30
assessment detects *where* a contract falls short of the mandatory clauses; the redliner turns each gap
into a **drafted amendment clause** the firm can send its ICT provider — grounded in the Art-30 clause
template, one batched LLM call, landed in an **inbox** for legal review.

**Governance: drafting, not sign-off.** A draft is a PROPOSAL (`status=pending`). It is **never**
auto-applied to the contract and never changes the assessment. A human (legal) **accepts** — optionally
replacing the AI text with their own `editedText` — or **rejects**. The AI draft and the human's final
text are both kept (audit trail). This mirrors the finding-approval posture everywhere in Retrieva: the
machine drafts, the management body decides.

## Flow (synchronous — one batched, fail-safe LLM call)

```
POST /amendments/draft { assessmentId }
   └─ load the CONTRACT_A30 assessment (org-scoped via its workspace; must be framework=CONTRACT_A30)
   └─ take results.gaps[] → keep gapLevel ∈ {partial, missing} that map to an Art-30 clause template
   └─ dedup against articles already drafted for this assessment (idempotent re-draft)
   └─ ONE batched LLM call → a proposed clause + rationale PER gap   (fail-safe → template stub)
   └─ persist new drafts (status=pending) → the amendment inbox
   ▼
GET /amendments?assessmentId=…           the inbox
POST /amendments/:id/accept { editedText? }   accept (optionally with the human's edited clause)
POST /amendments/:id/reject                   reject
```

**Grounding:** every draft is tied to a clause in `CONTRACT_A30_CLAUSES` (the 12 mandatory Art-30
obligations, `prompts/gapAnalysisPrompts.ts`) by its ref (`Art.30(2)(a)` …). The LLM is told the
obligation + what the contract currently says/omits (the gap's `vendorCoverage`) and drafts a
self-contained clause that would satisfy it.

**Fail-safe (the core discipline).** The dev model can malform JSON. If the batched generation throws /
returns nothing / omits a clause, that clause falls back to a **deterministic template-derived stub**
(`The Provider shall ensure … DORA <ref>: <clause text>`) with the gap's own `recommendation` as the
rationale. The endpoint never fails because the LLM did — you always get a reviewable draft per gap.

**Skip reasons** (returned so the caller sees why a gap produced no draft):
`not-a-gap` (clause is `covered`), `no-template` (article isn't one of the 12 Art-30 clauses),
`already-drafted` (a draft for that article already exists for this assessment).

## Endpoints

| Method + path | What |
|---|---|
| `POST /api/v1/amendments/draft` `{ assessmentId }` | draft amendment clauses for the assessment's gaps → `{ drafted, skipped, amendments }` |
| `GET /api/v1/amendments?status=&assessmentId=` | the amendment inbox (org-wide or scoped to one assessment) |
| `GET /api/v1/amendments/:id` | one draft |
| `POST /api/v1/amendments/:id/accept` `{ editedText? }` | accept (optionally with the human's edited clause) |
| `POST /api/v1/amendments/:id/reject` | reject |

```bash
curl -X POST https://<api>/api/v1/amendments/draft -H "Authorization: Bearer <jwt>" \
  -H 'Content-Type: application/json' -d '{"assessmentId":"<contract-a30-assessment-uuid>"}'
curl -H "Authorization: Bearer <jwt>" "https://<api>/api/v1/amendments?status=pending"
curl -X POST https://<api>/api/v1/amendments/<id>/accept -H "Authorization: Bearer <jwt>" \
  -H 'Content-Type: application/json' -d '{"editedText":"<legal-reviewed clause>"}'
```

## Design (mirrors discovery / surveillance / completeness)

| File | Role |
|---|---|
| `services/amendments/types.ts` | `GapInput` / `AssessmentContext` / `AmendmentDraft` / `DraftAmendmentsResult` |
| `services/amendments/amendmentService.ts` | orchestrator — map gaps → clause template, ONE batched generate, dedup, fail-safe (pure; injectable) |
| `modules/amendments/*` | the `draft` + inbox list/get/accept/reject API |
| `db/schema/contractAmendments.ts` | the amendment inbox (+ `amendment_status` enum) |
| `repositories/drizzle/ContractAmendmentRepository.ts` | persistence + the org-scoped assessment-gap loader |

Every collaborator is injectable → the orchestrator unit-tests with no DB/LLM
(`tests/unittest/amendmentService.unit.test.ts`).

## Not in this slice

The dashboard surface (a frontend story on `retrieva` — the inbox + accept-with-edit UX); clause drafting
for the full DORA framework assessment (this slice is scoped to the 12 Art-30 contract clauses, where the
mapping to a clause template is exact); exporting an accepted clause set as a redline document. The
redliner informs the contract; it does not sign it.
