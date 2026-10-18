# Unified per-vendor DORA risk score

A single **live 0–100 DORA risk score + RAG rating** per vendor, replacing the earlier coarse 3-bucket
compliance average (each assessment's High/Med/Low → 0/50/100, averaged). It rolls up the signals that
actually exist per vendor into one fine-grained number that updates on every input change.

```
score = clamp( 0.6·gap + 0.4·ddq − penalty(openRisks)·cifMultiplier , 0, 100 )
```

## Pillars

| Pillar | Weight | Source | Notes |
|---|---|---|---|
| **Gap analysis** | 0.6 | the vendor's latest **completed DORA assessment** `results.gaps[]` | per-clause credit: `covered`=1.0, `partial`=0.5, `missing`=0.0 (verdict words tolerated: `compliant`/`insufficient_evidence`=0.25/`non_compliant`); `not_applicable` excluded from the denominator |
| **DDQ verification** | 0.4 | the vendor's latest **completed questionnaire** `overallScore` | the dynamic DDQ + answer-vs-evidence score |
| **Open-risk penalty** | — (subtractive) | **open/mitigating** risks attributable to the vendor | `critical`=15, `high`=8, `medium`=3, `low`=1; `mitigating` counts half; **×1.5 for a CIF** |

**Re-normalisation:** if only one positive pillar has data (e.g. a DDQ but no assessment yet), the base
is that pillar alone. If **neither** has data, the score is **`null` / "not assessed"** — never a
misleading 100.

**RAG rating:** `GREEN` ≥80 · `AMBER` 60–79 · `RED` <60 — **or** a **CIF with an open-risk penalty > 20
is forced RED** regardless of the base (a critical vendor carrying heavy live risk is red even if its
paperwork scores well).

**CIF** is derived from `workspace.vendorTier ∈ {critical, important}`.

## Live / push model

The score is **cached on the vendor** (`workspaces.doraScore` / `doraRating` / `doraScoreBreakdown` /
`doraScoreAt`) so a vendor list renders every score with no recompute, and it is **push-recomputed**
whenever an input changes:

| Trigger | Where | Pillar moved |
|---|---|---|
| A DORA assessment completes | `services/gapAnalysisAgent.ts` | gap |
| A questionnaire is scored | `services/questionnaireScorer.ts` | DDQ |
| A finding is decided (± opens a risk) | `services/assessment/applyFindingDecision.ts` | risk penalty |
| A risk changes state | `modules/arrangementAssessment/arrangementAssessment.controller.ts` | risk penalty |

Recompute is **fire-and-forget + fail-safe** (`recalculateDoraScoreSafe` / `recalcForArrangementSafe`) —
it never breaks the operation that triggered it. Each recompute also appends a **`dora_score_history`**
row, which backs the **30-day trend** (`trend30Days = current − score ~30 days ago`; 0 until history
accumulates).

## API

```
GET /api/v1/workspaces/:workspaceId/dora-score
   → { score, rating, assessed, breakdown, scoredAt }   (the cached value — fast)

GET /api/v1/workspaces/:workspaceId/dora-score?recompute=true
   → { score, rating, assessed, trend30Days, components, metrics }   (forces a fresh roll-up first)
```

## Design + honest scope

| File | Role |
|---|---|
| `services/scoring/unifiedDoraScore.ts` | the **pure** engine (pillars → base → penalty → rating → trend) |
| `services/scoring/recalculateDoraScore.ts` | the orchestrator (assemble pillars → engine → persist) + the fail-safe trigger wrappers |
| `repositories/drizzle/DoraScoreRepository.ts` | the vendor→risk graph link + the score cache/history persistence |
| `db/schema/workspaces.ts` · `db/schema/doraScoreHistory.ts` | the cache columns + the trend history |

**The two-model reality (why the risk link is best-effort).** Assessments + questionnaires are
workspace-scoped (the vendor-profile model); **risks live in the arrangement graph**
(`organizationId`+`arrangementId`). A vendor's risks are reached via `workspace →
provider_node(kind=workspace) → arrangements → risks`. If the vendor hasn't been mapped into the
arrangement graph (common), there are no linked risks and the **penalty is simply 0** — the score then
reflects the gap + DDQ pillars honestly, rather than pretending a risk signal exists.

## Not in this slice

Per-control criticality weighting of the gap pillar (the assessment gaps don't currently carry a
per-clause priority — clauses are weighted equally; a future refinement could weight by the control
library's `cif_mandatory` flag); a websocket/SSE push to the UI (the score is push-*computed* server-side
and read on demand); configurable pillar weights per org.
