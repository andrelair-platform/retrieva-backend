# CTPP surveillance (RTV-94/95/96)

**Pillar 5 of the AI-native roadmap — watch the outside world.** A scheduled collector ingests external
signals about the org's **tracked providers** (critical ICT third parties — the CTPPs the ESAs oversee),
matches each to a provider node, computes its **blast-radius** on the concentration graph, and raises an
**alert** for material events — turning the static nth-party graph into a live risk radar.

**Governance:** surveillance **informs, never auto-rates.** A signal never changes a risk score or a
Register entry; material events land in the **event inbox** (the HITL surface) for a human to
acknowledge / resolve.

**Source today:** **Statuspage** incidents — the Atlassian-Statuspage v2 JSON API
(`<base>/api/v2/incidents.json`) that many CTPPs/SaaS expose (GitHub, Datadog, Cloudflare, Stripe, …).
Free, no-auth, uniform, and maps 1:1 to a provider node by its curated status URL. Adding a source is a
new client on the same rails (CVE/breach feeds → a later slice).

## Flow (async)

```
POST /run ─▶ surveillance_runs (queued) ─┐
                                          ▼
   worker (entity-scoped) ── listProviders (external nodes with a known status page)
                          ── poll Statuspage incidents.json  ── dedup (inbox externalId)
                          ── classify severity (LiteLLM, Langfuse; impact base + fail-safe)
                          ▼
   persist NEW events → compute blast-radius (arrangements + nth-party deps) → alert MATERIAL ones
                          ▼
   run → succeeded {polled, fetched, matched, newEvents, raised, bySeverity}
```

**Matching:** a tracked provider = an external `provider_node` whose `canonicalName` maps to a curated
status page (`config/surveillanceSources.ts`). **Blast-radius** (RTV-96): the business functions reached
by arrangements that use the provider **directly**, plus arrangements of any provider that depends on it
as a **sub-processor** (nth-party — `provider_dependencies` child = this node). **Material** = severity
≥ `high` **and** a critical/important function is exposed → raises a `surveillance.alert` audit entry +
flags the event `alerted`. Idempotent: an incident already in the inbox (by `externalId`) is skipped.

## Configure

```
SURVEILLANCE_ENABLED=true               # turn the connector on (else the collector is a no-op)
SURVEILLANCE_LOOKBACK_DAYS=30           # recency window for incidents (default 30)
SURVEILLANCE_STATUSPAGE_EXTRA=acme=https://status.acme.com,foo=https://foo.statuspage.io   # optional extra/override sources
# schedule (opt-in):
SURVEILLANCE_SCHEDULE_ENABLED=true
SURVEILLANCE_SCHEDULE_HOURS=6           # default 6h
SURVEILLANCE_SCHEDULE_ORG_ID=<org-uuid>
```
The egress NetworkPolicy's `toFQDNs` allow-list must include every status host polled (deployment side).

## Run

```bash
curl -X POST https://<api>/api/v1/surveillance/run -H "Authorization: Bearer <jwt>"
#   → 202 { runId, poll: "/api/v1/surveillance/runs/<id>" }
curl -H "Authorization: Bearer <jwt>" https://<api>/api/v1/surveillance/runs/<runId>
curl -H "Authorization: Bearer <jwt>" "https://<api>/api/v1/surveillance/events?status=open&severity=high"
curl -X POST https://<api>/api/v1/surveillance/events/<id>/acknowledge -H "Authorization: Bearer <jwt>"
curl -X POST https://<api>/api/v1/surveillance/events/<id>/resolve     -H "Authorization: Bearer <jwt>"
```

### Endpoints

| Method + path | What |
|---|---|
| `POST /api/v1/surveillance/run` | enqueue a sweep → `202 { runId }` |
| `GET /api/v1/surveillance/runs` | recent sweeps |
| `GET /api/v1/surveillance/runs/:id` | a run's summary + the events it opened |
| `GET /api/v1/surveillance/events?status=&severity=` | the event inbox |
| `POST /api/v1/surveillance/events/:id/acknowledge` | mark seen (still open) |
| `POST /api/v1/surveillance/events/:id/resolve` | close the event |

## Severity → action

| Feed impact | Base severity | Action |
|---|---|---|
| `critical` | critical | **alert** if it exposes a critical/important function (else annotate) |
| `major` | high | **alert** if it exposes a critical/important function (else annotate) |
| `minor` | medium | annotate the inbox silently |
| `none` | low | annotate (often `relevant:false` → dropped as noise) |

The LLM refines the base severity + drops pure noise (scheduled maintenance); deterministic fields
(`externalId`, `url`, `observedAt`, feed `impact`) are parsed, never LLM-guessed.

## Design (source-agnostic rails — mirrors discovery/completeness)

| File | Role |
|---|---|
| `config/surveillanceSources.ts` | curated canonicalName→status-page map (+ env extras); `statuspageForProvider`, `isSurveillanceConfigured` |
| `services/surveillance/types.ts` | `SurveillanceSignal` / `SurveillanceEventDraft` / `TrackedProvider` |
| `services/surveillance/statuspageClient.ts` | Statuspage `incidents.json` lister (fetch injectable) |
| `services/surveillance/classify.ts` | impact→base + LLM severity/relevance (fail-safe) |
| `services/surveillance/surveillanceService.ts` | orchestrator — poll + dedup + classify (pure; injectable) |
| `services/surveillance/enqueue.ts` · `config/queue.ts` · `types/jobs.ts` | the `surveillanceJobs` queue + schedule |
| `workers/surveillanceWorker.ts` | persist + blast-radius + alert (`processSurveillanceJob` injectable) |
| `db/schema/surveillanceRuns.ts` · `surveillanceEvents.ts` | run-tracking + the event inbox (+ enums) |
| `repositories/drizzle/SurveillanceRepository.ts` | persistence + `computeBlastRadius` (arrangement model) |
| `modules/surveillance/*` | the run/runs/events + acknowledge/resolve API |

Every collaborator is injectable → the whole flow unit-tests with no network/LLM/DB
(`tests/unittest/{statuspageClient,surveillanceClassify,surveillanceService,surveillanceWorker}.unit.test.ts`).

## Not in this slice

CVE/breach feed clients (the rails are source-agnostic — a later slice); the dashboard visualisation of
per-node live signal state (a frontend story on `retrieva`); predictive scoring. Per-org source config
(the status-page map is platform-level today).
