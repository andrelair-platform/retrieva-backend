# Discovery connectors (RTV-91)

The **autonomous discovery agents** (AI-native roadmap, Pillar 1). Each connector sweeps a source
system (read-only) and **proposes** DORA third-party arrangements for the ICT apps in use — so shadow
IT surfaces itself into the Register of Information instead of being typed in by hand.

**Sources today:** **Okta** (enterprise IdP), **Authentik** (this platform's own IdP) and **ERPNext**
(AP/ERP — RTV-92). The IdP sources discover apps by *identity*; the ERP source discovers third parties
by *spend* (the suppliers we pay), so it catches shadow IT an IdP can't see. Adding a source is just a
new client; the rails below are source-agnostic.

> **Scaling to real customers (not hand-built per vendor).** Okta/Authentik/ERPNext are the concrete
> connectors *this* deployment (ktayl) uses — reference implementations of the `DiscoverySource` /
> `DiscoveredApp` plug-in contract, not the product ceiling. A customer on Entra ID + SAP uses the same
> rails via: first-class connectors for the common systems · standard-protocol connectors (SCIM/OData/
> generic REST) · and a **generic AI-ingestion source** (upload a CSV / API dump → the LLM normalises
> arbitrary columns into `DiscoveredApp`) as the universal fallback. That generic path is the AI-native
> differentiator and is backlogged (RTV-106/107); the specific connectors are the high-value head of a
> long tail the AI covers.

**Governance rule they obey:** *autonomous discovery & drafting, never autonomous sign-off.* A
connector **never writes an arrangement**. It produces proposals in an **inbox**; a human confirms
each one into the Register (or dismisses it).

**Async (RTV-91c).** A sweep maps every app with a per-app LLM call, which exceeds the ingress 60s
timeout on a large estate. So the sweep runs as a **BullMQ job**: `POST …/run` enqueues it and returns
`202 { runId }`; the **discovery worker** runs the sweep off the request path and persists the result
to `discovery_runs` + the proposal **inbox** (`discovery_proposals`), which you poll.

## Flow (identical for every source)

[![Discovery sweep (async)](../architecture/img/discovery-flow.png)](../architecture/img/discovery-flow.svg)

*Generated from code — `docs/diagrams/discovery_flow.py` (mingrammer `diagrams`).*

*Governance holds end-to-end: the worker **drafts** proposals into the inbox; nothing reaches the
Register until a human **confirms** (filling the fields an IdP can't know).*

## Configure (each source optional; unset ⇒ `503 not configured`)

```
# Okta
OKTA_ORG_URL=https://your-org.okta.com
OKTA_API_TOKEN=<read-only SSWS token>

# Authentik (this platform's IdP)
AUTHENTIK_BASE_URL=https://auth.your-domain
AUTHENTIK_API_TOKEN=<read-only API token>

# ERPNext (AP/ERP — discovers third parties from Purchase-Invoice spend)
ERPNEXT_BASE_URL=https://erp.your-domain
ERPNEXT_API_KEY=<frappe api key>
ERPNEXT_API_SECRET=<frappe api secret>   # → Authorization: token <key>:<secret>
ERPNEXT_INVOICE_LOOKBACK_DAYS=365        # optional (default 365)
```

Tokens are runtime secrets — never committed.

## Run (async)

```bash
# 1. Trigger a sweep → 202 { runId }. dryRun=true previews (counts + inline proposals, no inbox/audit).
curl -X POST https://<api>/api/v1/discovery/authentik/run \
  -H "Authorization: Bearer <jwt>" -H 'Content-Type: application/json' -d '{}'
#   → { "ok": true, "data": { "runId": "…", "status": "queued", "poll": "/api/v1/discovery/runs/…" } }

# 2. Poll the run → status + proposals (inbox items for a real run; inline preview for a dry run).
curl -H "Authorization: Bearer <jwt>" https://<api>/api/v1/discovery/runs/<runId>

# 3. The inbox across runs:
curl -H "Authorization: Bearer <jwt>" "https://<api>/api/v1/discovery/proposals?status=pending"

# 4. Confirm a proposal into an arrangement (fill the fields the IdP can't know, esp. legalEntityName):
curl -X POST https://<api>/api/v1/discovery/proposals/<id>/confirm \
  -H "Authorization: Bearer <jwt>" -H 'Content-Type: application/json' \
  -d '{"proposal": {"legalEntityName": "Acme SA"}}'
#   or dismiss it:
curl -X POST https://<api>/api/v1/discovery/proposals/<id>/dismiss -H "Authorization: Bearer <jwt>"
```

`GET …/runs/:id` response:

```jsonc
{
  "ok": true,
  "data": {
    "run": { "id": "…", "source": "authentik", "status": "succeeded", "dryRun": false,
             "discovered": 42, "proposed": 18, "skippedCount": 1, "startedAt": "…", "finishedAt": "…" },
    "proposals": [
      { "id": "…", "status": "pending", "source": "authentik", "externalName": "Grafana",
        "proposal": { "providerName": "Grafana Labs", "ictServiceName": "Observability",
                      "businessFunctionName": "IT Operations", "legalEntityName": null,
                      "criticality": "important", "confidence": 0.8, "notes": "…" } }
    ]
  }
}
```

### Endpoints

| Method + path | What |
|---|---|
| `POST /api/v1/discovery/{okta,authentik,erpnext}/run` | enqueue a sweep → `202 { runId }` |
| `GET /api/v1/discovery/runs` | recent sweeps for the org |
| `GET /api/v1/discovery/runs/:id` | a run's status + its proposals |
| `GET /api/v1/discovery/proposals?status=&runId=` | the proposal inbox |
| `POST /api/v1/discovery/proposals/:id/confirm` | confirm → create the arrangement (body merges over the proposal) |
| `POST /api/v1/discovery/proposals/:id/dismiss` | drop a proposal |

## Provenance & dedupe

- **Provenance** rides alongside each proposal: `{ source, externalId, externalName }` — so a confirmed
  arrangement is traceable to its exact source record.
- **Dedupe** is two-layer: against providers already registered for the org (by normalised display
  name, before *and* after LLM mapping) and within a single sweep (by source app id + mapped provider).
- A non-dry run writes one `discovery.<source>.run` entry to the audit log (counts only, no PII).

## Design (source-agnostic rails)

| File | Role |
|---|---|
| `services/discovery/types.ts` | `DiscoveredApp` + `DiscoverySource` — the normalised shape every client emits |
| `config/okta.ts`, `config/authentik.ts`, `config/erpnext.ts` | per-source config (graceful "not configured") |
| `services/discovery/oktaClient.ts` | Okta `/api/v1/apps` lister (SSWS auth, `Link` pagination) |
| `services/discovery/authentikClient.ts` | Authentik `/api/v3/core/applications/` lister (Bearer, page-number pagination) |
| `services/discovery/erpnextClient.ts` | ERPNext `Purchase Invoice` AP lister (Frappe `token` auth, `limit_start` pagination) → aggregates by supplier (spend/count/last-date) |
| `services/discovery/appToProposal.ts` | LLM app→proposal mapper (reuses intake's pure `normalizeProposal`; LLM injectable) |
| `services/discovery/discoveryService.ts` | orchestrator — `runDiscovery({source})` + a `CLIENTS` registry; dedupe, dry-run, audit; collaborators injectable |
| `config/queue.ts` · `types/jobs.ts` | the `discoveryJobs` BullMQ queue + `DiscoveryJobData` (RTV-91c async) |
| `workers/discoveryWorker.ts` | the worker: runs the sweep in the caller's entity scope, persists run + inbox (`processDiscoveryJob` is injectable) |
| `db/schema/discoveryRuns.ts` · `discoveryProposals.ts` | the run-tracking table + the proposal inbox (+ enums) |
| `repositories/drizzle/DiscoveryRepository.ts` | run/inbox persistence (org-scoped reads, RTV-54 entity filter) |
| `modules/discovery/*` | `POST …/run` (enqueue) + the runs/proposals polling + confirm/dismiss endpoints |

All LLM calls go through the LiteLLM gateway (`purpose: 'analysis'`, `jsonMode`) and are Langfuse-traced.
Every collaborator (client, mapper, repo, audit, worker handler) is injectable, so the whole flow
unit-tests with no network, model, or DB (`tests/unittest/{okta,authentik}Client.unit.test.ts`,
`appToProposal.unit.test.ts`, `discoveryService.unit.test.ts`, `discoveryWorker.unit.test.ts`).

## Scheduling (repeatable · RTV-91d)

Besides the API trigger, the sweep can run on a **repeatable schedule**. Opt in with env (off by default):

```
DISCOVERY_SCHEDULE_ENABLED=true      # register the repeatable job (else it's removed on boot)
DISCOVERY_SCHEDULE_HOURS=24          # interval (default 24h)
DISCOVERY_SCHEDULE_ORG_ID=<org-uuid> # the org to sweep (connector creds are one platform-level credential today)
```

On the interval, a `discovery-scheduled-sweep` job **fans out** a (system) real-run per *configured*
source for that org (`workers/discoveryWorker.ts → runScheduledSweep`, registered by
`config/queue.ts → scheduleDiscoverySweep` at API-process boot). Two guards make repeats safe:

- **System scope** — a scheduled run has no user, so the worker sweeps the **whole org** (a
  `readAcross` entity scope) instead of an empty, default-deny one — so the registered-provider dedup works.
- **Idempotent** — apps already in the inbox (pending/confirmed, by `externalId`) are **skipped**
  (`reason: already-proposed`), so a daily sweep doesn't re-propose the same app every cycle.

## Adding another source

1. `config/<source>.ts` — `get<Source>Config()` / `is<Source>Configured()`.
2. `services/discovery/<source>Client.ts` — `list<Source>Apps()` returning `DiscoveredApp[]`.
3. Add `<source>` to `DiscoverySource` + one entry in the `CLIENTS` registry.
4. Add the route + `makeRun('<source>')` handler. Done — the mapper, dedupe, audit and tests are shared.

## Not in this slice

Non-IdP sources (AP/ERP → RTV-92) and per-org connector credentials / per-org schedules (the connector
creds are a single platform-level credential today; the schedule sweeps one configured org).
