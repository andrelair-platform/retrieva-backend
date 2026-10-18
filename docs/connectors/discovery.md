# Discovery connectors (RTV-91)

The **autonomous discovery agents** (AI-native roadmap, Pillar 1). Each connector sweeps a source
system (read-only) and **proposes** DORA third-party arrangements for the ICT apps in use — so shadow
IT surfaces itself into the Register of Information instead of being typed in by hand.

**Sources today:** **Okta** (enterprise IdP) and **Authentik** (this platform's own IdP). Adding a
source is just a new client; the rails below are source-agnostic.

**Governance rule they obey:** *autonomous discovery & drafting, never autonomous sign-off.* A
connector **never writes an arrangement**. It returns proposals; a human confirms each one through the
existing intake flow.

## Flow (identical for every source)

```
source /apps (read-only)  →  LLM maps each app → proposed arrangement  →  dedupe  →  proposals[]
                             (LiteLLM gateway, Langfuse-traced)                          │
                                                                                         ▼
                                           human confirms → POST /api/v1/arrangements/intake/confirm
                                                           → arrangement created in the Register
```

## Configure (each source optional; unset ⇒ `503 not configured`)

```
# Okta
OKTA_ORG_URL=https://your-org.okta.com
OKTA_API_TOKEN=<read-only SSWS token>

# Authentik (this platform's IdP)
AUTHENTIK_BASE_URL=https://auth.your-domain
AUTHENTIK_API_TOKEN=<read-only API token>
```

Tokens are runtime secrets — never committed.

## Run

```bash
# Okta — preview (dry run; produces proposals, records nothing):
curl -X POST https://<api>/api/v1/discovery/okta/run \
  -H "Authorization: Bearer <jwt>" -H 'Content-Type: application/json' -d '{"dryRun": true}'

# Authentik — real run (same proposals + an audit-log record of the sweep):
curl -X POST https://<api>/api/v1/discovery/authentik/run \
  -H "Authorization: Bearer <jwt>" -H 'Content-Type: application/json' -d '{}'
```

Response:

```jsonc
{
  "ok": true,
  "data": {
    "source": "authentik",
    "configured": true,
    "dryRun": false,
    "discovered": 42,          // apps returned by the source
    "proposed": 18,            // new proposals (after dedupe)
    "proposals": [
      {
        "proposal": { "providerName": "Grafana Labs", "ictServiceName": "Observability",
                      "businessFunctionName": "IT Operations", "legalEntityName": null,
                      "criticality": "important", "confidence": 0.8, "notes": "..." },
        "provenance": { "source": "authentik", "externalId": "…", "externalName": "Grafana" }
      }
    ],
    "skipped": [ { "externalId": "…", "externalName": "Slack", "reason": "already-registered" } ]
  }
}
```

Confirm a proposal by POSTing its `proposal` object to `/api/v1/arrangements/intake/confirm` (the
analyst fills `legalEntityName` — an IdP can't know which entity contracts the app).

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
| `config/okta.ts`, `config/authentik.ts` | per-source config (graceful "not configured") |
| `services/discovery/oktaClient.ts` | Okta `/api/v1/apps` lister (SSWS auth, `Link` pagination) |
| `services/discovery/authentikClient.ts` | Authentik `/api/v3/core/applications/` lister (Bearer, page-number pagination) |
| `services/discovery/appToProposal.ts` | LLM app→proposal mapper (reuses intake's pure `normalizeProposal`; LLM injectable) |
| `services/discovery/discoveryService.ts` | orchestrator — `runDiscovery({source})` + a `CLIENTS` registry; dedupe, dry-run, audit; collaborators injectable |
| `modules/discovery/*` | `POST /api/v1/discovery/{okta,authentik}/run` |

All LLM calls go through the LiteLLM gateway (`purpose: 'analysis'`, `jsonMode`) and are Langfuse-traced.
Every collaborator (client, mapper, repo, audit) is injectable, so the whole flow unit-tests with no
network, model, or DB (`tests/unittest/{okta,authentik}Client.unit.test.ts`,
`appToProposal.unit.test.ts`, `discoveryService.unit.test.ts`).

## Adding another source

1. `config/<source>.ts` — `get<Source>Config()` / `is<Source>Configured()`.
2. `services/discovery/<source>Client.ts` — `list<Source>Apps()` returning `DiscoveredApp[]`.
3. Add `<source>` to `DiscoverySource` + one entry in the `CLIENTS` registry.
4. Add the route + `makeRun('<source>')` handler. Done — the mapper, dedupe, audit and tests are shared.

## Not in this slice

Scheduled/continuous sweeps, non-IdP sources (AP/ERP → RTV-92), and a persisted discovery inbox
(proposals are returned for immediate confirmation, mirroring contract intake).
