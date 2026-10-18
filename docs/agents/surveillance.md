# CTPP surveillance (RTV-94/95/96)

**Pillar 5 of the AI-native roadmap — watch the outside world.** A scheduled collector ingests external
signals about the org's **tracked providers** (critical ICT third parties — the CTPPs the ESAs oversee),
matches each to a provider node, computes its **blast-radius** on the concentration graph, and raises an
**alert** for material events — turning the static nth-party graph into a live risk radar.

**Governance:** surveillance **informs, never auto-rates.** A signal never changes a risk score or a
Register entry; material events land in the **event inbox** (the HITL surface) for a human to
acknowledge / resolve.

**Sources today — two, on the same source-agnostic rails:**
- **Statuspage incidents** (outages) — the Atlassian-Statuspage v2 JSON API (`<base>/api/v2/incidents.json`)
  that many CTPPs/SaaS expose (GitHub, Datadog, Cloudflare, Stripe, …). Free, no-auth, uniform; mapped to
  a provider node by its curated status URL (`config/surveillanceSources.ts`).
- **CVE advisories** (vulnerabilities) — **OSV.dev** (`POST https://api.osv.dev/v1/query`, free/no-auth/
  fast; chosen over the rate-limited, flaky NVD v2). A CTPP is tracked by the OSS packages / SDKs it (or
  we) depend on — a curated `canonicalName → {ecosystem,name}[]` map (`cvePackagesForProvider`, env-
  extensible via `SURVEILLANCE_CVE_EXTRA`). Both feeds normalise to the same `SurveillanceSignal` and flow
  through the identical classify → blast-radius → alert pipeline.

Adding a further source (breach feeds, regulatory actions) is a new client on the same rails.
> **Egress:** the surveillance `toFQDNs` allow-list must include `api.osv.dev` (alongside the status
> hosts) when the CVE source is enabled (deployment side).

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

**Cost control (the LLM runs only where it adds value).** A sweep does NOT fan out one LLM call per
historical incident. Two guards:
- **Incident cap** per provider — `SURVEILLANCE_INCIDENT_LIMIT` (default **15**), most-recent-first, within
  the lookback window.
- **Material-candidate gate** (`shouldLlmClassify`) — the LLM classifies ONLY incidents that are still
  **unresolved** (live) **or** **high-impact** (`major`/`critical`). The resolved/low-impact tail is
  classified **deterministically** from the feed `impact` (no LLM): severity = base, `relevant = impact
  != none`. So steady-state re-polls (everything deduped or resolved) cost ~zero LLM calls.

## Design (source-agnostic rails — mirrors discovery/completeness)

| File | Role |
|---|---|
| `config/surveillanceSources.ts` | curated status-page map + CVE package map (+ env extras); `statuspageForProvider`, `cvePackagesForProvider` |
| `services/surveillance/types.ts` | `SurveillanceSignal` / `SurveillanceEventDraft` / `TrackedProvider` (statusUrl + cvePackages) |
| `services/surveillance/statuspageClient.ts` | Statuspage `incidents.json` lister (fetch injectable) |
| `services/surveillance/cveClient.ts` | OSV.dev advisory lister — `listCveAdvisories` + `cveToImpact` (fetch injectable) |
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

Breach-feed + regulatory-action + geopolitical sources (the rails are source-agnostic — a further
client each; outages via Statuspage + CVEs via OSV are built); the dashboard visualisation of per-node
live signal state (a frontend story on `retrieva`); predictive scoring. Per-org source config (the
status-page + CVE maps are platform-level + env-extensible today, not yet a per-org UI).
