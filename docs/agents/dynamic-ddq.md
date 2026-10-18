# Dynamic DDQ generation & verification (RTV-103/104/105)

**Pillar 2 upgrade — move vendor due diligence from a static form to interactive diligence that catches
"paper compliance".** Instead of sending every vendor the same fixed questionnaire, Retrieva (1) **generates
a questionnaire tailored to the vendor's criticality**, (2) when the vendor replies, **cross-references
their answers against their own technical documentation** to flag discrepancies, and (3) **asks targeted
follow-up questions** where an answer was weak or contradicted — a back-and-forth, not a one-shot form.

**Governance:** the loop **informs**; it never auto-fails a vendor. Scoring stays as-is; contradictions
land in an inbox for analyst review (acknowledge / resolve / dismiss).

## The loop

```
1. GENERATE (RTV-104)   POST /questionnaires { adaptive:true }
      tailor by tier + service type → send to vendor
2. REPLY + SCORE        vendor answers via the portal → existing scorer (per-answer score + gap)
3. VERIFY (RTV-105)     POST /ddq-contradictions/run { questionnaireId }
      cross-check each answer vs the vendor's uploaded evidence → contradiction inbox
4. FOLLOW-UP (RTV-104)  POST /questionnaires/:id/follow-ups
      probe the weak / contradicted answers → re-open for round 2  ─┐
                                                                     └─▶ back to step 2
```

---

## 1. Dynamic generation (RTV-104)

`POST /api/v1/questionnaires` with `adaptive: true`. The DORA question template (`seeds/
questionnaireTemplate.seed.ts`) is the **coverage backbone** — never dropped silently — but the AI shapes
the actual set by the vendor's `workspace.vendorTier` + `serviceType`, **both directions**:

| Tier | Backbone | Tailored extras |
|---|---|---|
| `critical` | full DORA battery | deep probes: tested exit (Art.28(8)), sub-outsourcing chain (Art.30(2)(e)), incident-SLA (Art.30(3)(d)), TLPT (Art.26) + service-specific |
| `important` | full DORA battery | RTO/RPO evidence, sub-processor register + service-specific |
| `standard` / unknown | **trimmed to a proportionate core** — one question per DORA domain | minimal (secure-deletion-on-exit) + service-specific |

Service-type extras (cloud → data-residency + shared-responsibility/encryption; software → secure SDLC +
SBOM; data → classification + flows; network → availability/DDoS) apply at any tier.

One batched LLM call proposes the tailored extras; it is **fail-safe** — on any error the extras fall back
to a curated deterministic add-on bank, unioned with the LLM output and deduped against the backbone. So
even a perfect LLM never drops a must-ask question, and a failed call still yields the deterministic set.
`adaptive` is opt-in: omit it and you get the exact legacy behaviour (the full static template).

Each question carries a `source` tag (`base` | `adaptive`) + `tier`/`serviceType` provenance.

## 2. Verification — answer-vs-evidence contradiction (RTV-105)

`POST /api/v1/ddq-contradictions/run { questionnaireId }`. Scoring judges an answer **in isolation** — a
vendor can *claim* "we encrypt at rest and hold ISO 27001" and score well even if their uploaded SOC2 says
otherwise. The detector closes that gap: for each answered question it semantic-searches the vendor's own
evidence (the arrangement's Qdrant collection, `arrangement_<id>`), and **one batched LLM call** judges
whether the answer contradicts / is unsupported by that evidence. Contradictions land in the
`ddq_contradictions` inbox with the **retrieved evidence spans as citations** (deterministic — not
LLM-guessed).

- **Needs an arrangement** — evidence is arrangement-scoped; a questionnaire not bound to an arrangement
  has no corpus to check (every answer skipped `no-arrangement`).
- **Fail-safe = conservative** — an LLM error raises **no** contradiction (we never manufacture a flag we
  can't ground). An answer with no retrieved evidence is skipped (`no-evidence`), not flagged.
- Dedup on `(org, questionnaire, question)` → re-running is idempotent.

| Method + path | What |
|---|---|
| `POST /api/v1/ddq-contradictions/run` `{ questionnaireId }` | cross-check → `{ answersChecked, evidenceMatched, flagged, skipped, contradictions }` |
| `GET /api/v1/ddq-contradictions?status=&questionnaireId=` | the contradiction inbox |
| `GET /api/v1/ddq-contradictions/:id` | one contradiction |
| `POST /api/v1/ddq-contradictions/:id/acknowledge` | mark seen |
| `POST /api/v1/ddq-contradictions/:id/resolve` | handled |
| `POST /api/v1/ddq-contradictions/:id/dismiss` | reviewed → false positive |

## 3. Interactive follow-ups (RTV-104)

`POST /api/v1/questionnaires/:id/follow-ups`. After replies are scored + verified, the AI reviews the
answers and generates **one targeted follow-up per weak or contradicted answer**:

- **Selection (deterministic):** answered questions that are `contradicted` (in the RTV-105 inbox, still
  open/acknowledged), `low-score` (< 60), or a `gap` (partial/missing). Never a follow-up of a follow-up
  (bounded depth), never an already-probed question, bounded per round.
- **Drafting (one batched LLM call, fail-safe):** a pointed question demanding the specific missing detail
  / reconciling the discrepancy. On LLM error → a deterministic probe (different wording for a
  contradiction vs a weak answer).
- **Re-open:** the follow-ups are appended (`source:'followup'`, `parentId`, `round`) and the questionnaire
  goes back to `partial` so the vendor can answer a second round through the same portal (re-notify with
  `POST /:id/send`). A later pass increments the round.

## Design (mirrors the other agents — pure + injectable)

| File | Role |
|---|---|
| `services/ddq/dynamicDdq.ts` | tier-proportional backbone selection + tailored extras (LLM ∪ floor, fail-safe) |
| `services/ddq/contradictionDetector.ts` | answer-vs-evidence cross-check (evidence search + batched judge, fail-safe) |
| `services/ddq/followUpGenerator.ts` | select weak/contradicted answers → batched follow-up drafting (fail-safe) |
| `services/QuestionnaireService.ts` | `createQuestionnaire({adaptive})` + `generateFollowUps()` orchestration |
| `modules/ddq-contradictions/*` | the contradiction run + inbox API |
| `db/schema/ddqContradictions.ts` | the contradiction inbox (+ severity/status enums) |
| `repositories/drizzle/DdqContradictionRepository.ts` | questionnaire-answer loader + inbox persistence |

Every collaborator is injectable → the three agents unit-test with no DB/LLM/Qdrant
(`tests/unittest/{dynamicDdq,contradictionDetector,followUpGenerator}.unit.test.ts`).

## Not in this slice

The frontend UX for the interactive loop (the analyst console + the vendor's round-2 portal view) is a
story on `retrieva`; auto-running verification on scoring completion (today it's an explicit `/run`); per-org
tuning of the score threshold / tier→coverage policy.
