# Dynamic exit strategy & transition planning (RTV-99/100/101/102)

**Pillar 4 — the largest net-new area.** For vendors supporting **Critical or Important Functions
(CIFs)**, DORA Art. 28(8) requires a viable **exit strategy** and a documented **transition plan**.
Retrieva already has CIF identification + criticality tiers + exit-difficulty on each arrangement; this
builds the exit capability on top — three AI-drafted artefacts per CIF arrangement:

| Story | Artefact (`type`) | What it answers |
|---|---|---|
| **RTV-100** | `provider_match` | credible alternative providers to switch to |
| **RTV-101** | `exit_blueprint` | the phased exit plan (portability timeline, key handover, parallel-run) |
| **RTV-102** | `reintegration_model` | the effort to move off: in-house / switch, difficulty, timeline, cost drivers |

**Governance: Retrieva proposes, the business decides.** Every artefact is a **draft for the risk
owner** (`status: draft`) who **approves** or **rejects** it (terminal, stamped). It is never auto-applied
and never changes the arrangement. One current artefact per `(org, arrangement, type)`: regenerating a
still-draft artefact replaces its payload; a decided one is preserved (regenerate → `409`, reject it to
redraft).

**CIF-only.** Exit planning applies to `critical`/`important` arrangements (proportionality). A generate
call on a `standard` arrangement returns `400`.

## Flow

```
POST /exit-strategy/arrangements/:arrangementId/provider-matches | exit-blueprint | reintegration-model
   └─ load the arrangement context (org-scoped): provider, function, criticality, exitDifficulty,
      dependency, dataClasses, dataResidency + the org's OTHER same-type providers (concentration-aware)
   └─ gate: must be a CIF (critical/important)
   └─ ONE fail-safe LLM call → the typed artefact payload   (fail-safe → deterministic template)
   └─ upsert the DRAFT into the exit-artefact inbox
   ▼
GET /exit-strategy?status=&arrangementId=&type=     the inbox
POST /exit-strategy/:id/approve { note? }           risk owner accepts
POST /exit-strategy/:id/reject  { note? }           rejects (then it can be regenerated)
```

## The three agents

### RTV-100 — alternative-provider matching ("Curated Substitutes Catalog & LLM Matcher")
Not an external market-data scrape. Candidates come from **three sources**, each tagged with its
provenance (`source`) so the risk owner sees where it came from:
1. **`internal_registry`** — vendors already onboarded + vetted in the org's **Register of Information**
   of the same type (known-good, low onboarding cost) — honestly flagged as **concentration-increasing**
   (switching to one you already use consolidates reliance; weigh against Art. 29).
2. **`curated_substitutes_catalog`** — the **Verified Substitutes Registry** (`substitute_providers`): a
   maintained table of credible alternatives per type, platform-seeded on boot + extensible per org.
3. **`ai_proposed`** — the LLM, for the long tail, grounded in the provider type + data-residency/
   data-class constraints and the org's existing concentration.

Composed with **concentration-aware dedup** (vetted registry first, then catalog, then AI; the incumbent
is never proposed). **Fail-safe**: if the LLM fails, the registry + catalog still produce a draft (a small
hard-coded floor is the last resort). Every candidate is a **proposal to verify, not an endorsement**.

### RTV-101 — exit-blueprint generator
A structured, phased blueprint — trigger & notice → data portability & extraction → key handover & KT →
parallel run & cutover → decommission & secure deletion — with per-phase duration/activities/dependencies,
a data-portability approach, a parallel-run recommendation (defaulted on for critical / high exit-
difficulty), key-handover items, risks, and assumptions. Scaled by `exitDifficulty` + data sensitivity.
Fail-safe → a deterministic context-derived template (always a usable draft).

### RTV-102 — reintegration modelling
An estimate of the effort to move off the incumbent — approach (in-house / switch-provider / hybrid),
difficulty, timeline, cost drivers, capability gaps, and data-migration complexity (raised for sensitive
data classes). Fail-safe → a deterministic estimate derived from exit-difficulty + dependency + data
sensitivity.

## Endpoints

| Method + path | What |
|---|---|
| `POST /api/v1/exit-strategy/arrangements/:id/provider-matches` | draft alternative providers (RTV-100) |
| `POST /api/v1/exit-strategy/arrangements/:id/exit-blueprint` | draft the exit blueprint (RTV-101) |
| `POST /api/v1/exit-strategy/arrangements/:id/reintegration-model` | draft the reintegration estimate (RTV-102) |
| `GET /api/v1/exit-strategy?status=&arrangementId=&type=` | the exit-artefact inbox |
| `GET /api/v1/exit-strategy/:id` | one artefact |
| `POST /api/v1/exit-strategy/:id/approve` `{ note? }` | risk owner approves |
| `POST /api/v1/exit-strategy/:id/reject` `{ note? }` | risk owner rejects |

## Design (mirrors the other agents — pure + injectable + fail-safe)

| File | Role |
|---|---|
| `services/exitStrategy/types.ts` | `ArrangementContext` + the three typed payload shapes |
| `services/exitStrategy/providerMatching.ts` | RTV-100 — 3-source matcher (registry + catalog + LLM) |
| `services/exitStrategy/exitBlueprint.ts` | RTV-101 — LLM blueprint + deterministic template |
| `services/exitStrategy/reintegration.ts` | RTV-102 — LLM estimate + deterministic estimate |
| `db/schema/substituteProviders.ts` · `repositories/drizzle/SubstituteProviderRepository.ts` · `seeds/substituteProviders.seed.ts` | the Verified Substitutes Registry (curated catalog) |
| `modules/exit-strategy/*` | the generate + inbox (list/get/approve/reject) API |
| `db/schema/exitArtefacts.ts` | the artefact inbox (+ type/status enums) |
| `repositories/drizzle/ExitArtefactRepository.ts` | CIF arrangement-context loader + inbox persistence |

Every collaborator is injectable → the agents + controller unit-test with no DB/LLM
(`tests/unittest/exitStrategy{Services,Controller}.unit.test.ts`).

## Not in this slice

The frontend (the exit-planning console + artefact rendering) is a story on `retrieva`; wiring an
approved artefact to the `exit_strategy` evidence category / the arrangement lifecycle `start_exit`
transition; a CRUD API for org-specific catalog entries (the registry table + platform seeds exist; an
"add our own substitute" endpoint is the next slice); cost modelling with real rate cards.
