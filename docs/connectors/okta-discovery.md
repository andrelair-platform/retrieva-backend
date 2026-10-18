# Okta discovery connector (RTV-91)

The first **autonomous discovery agent** (AI-native roadmap, Pillar 1). It sweeps an organisation's
Okta tenant (read-only) and **proposes** DORA third-party arrangements for the ICT apps in use — so
shadow IT surfaces itself into the Register of Information instead of being typed in by hand.

**Governance rule it obeys:** *autonomous discovery & drafting, never autonomous sign-off.* The
connector **never writes an arrangement**. It returns proposals; a human confirms each one through the
existing intake flow.

## Flow

```
Okta /api/v1/apps (ACTIVE)  →  LLM maps each app → proposed arrangement  →  dedupe  →  proposals[]
                                (LiteLLM gateway, Langfuse-traced)                         │
                                                                                           ▼
                                             human confirms → POST /api/v1/arrangements/intake/confirm
                                                             → arrangement created in the Register
```

## Configure

Set two env vars (optional — unset ⇒ the endpoint returns `503 not configured`):

```
OKTA_ORG_URL=https://your-org.okta.com
OKTA_API_TOKEN=<read-only SSWS token>     # runtime secret — never commit
```

The token only needs read access to `/api/v1/apps`.

## Run

```bash
# Preview (dry run — produces proposals, records nothing):
curl -X POST https://<api>/api/v1/discovery/okta/run \
  -H "Authorization: Bearer <jwt>" -H 'Content-Type: application/json' \
  -d '{"dryRun": true}'

# Real run (same proposals + an audit-log record of the sweep):
curl -X POST https://<api>/api/v1/discovery/okta/run \
  -H "Authorization: Bearer <jwt>" -H 'Content-Type: application/json' -d '{}'
```

Response:

```jsonc
{
  "ok": true,
  "data": {
    "configured": true,
    "dryRun": false,
    "discovered": 42,          // ACTIVE apps returned by Okta
    "proposed": 18,            // new proposals (after dedupe)
    "proposals": [
      {
        "proposal": { "providerName": "Datadog", "ictServiceName": "Observability",
                      "businessFunctionName": "IT Operations", "legalEntityName": null,
                      "criticality": "important", "confidence": 0.8, "notes": "..." },
        "provenance": { "source": "okta", "externalId": "0oa…", "externalName": "Datadog" }
      }
    ],
    "skipped": [ { "externalId": "0oa…", "externalName": "Slack", "reason": "already-registered" } ]
  }
}
```

Confirm a proposal by POSTing its `proposal` object to `/api/v1/arrangements/intake/confirm` (the
analyst fills `legalEntityName` — Okta can't know which entity contracts the app).

## Provenance & dedupe

- **Provenance** rides alongside each proposal: `{ source: 'okta', externalId, externalName }` — the
  Okta app id, so a confirmed arrangement is traceable to its source record.
- **Dedupe** is two-layer: against providers already registered for the org (by normalised display
  name, before *and* after LLM mapping) and within a single sweep (by Okta app id + mapped provider).
- A non-dry run writes one `discovery.okta.run` entry to the audit log (counts only, no PII).

## Design notes

| File | Role |
|---|---|
| `config/okta.ts` | config (graceful "not configured") |
| `services/discovery/oktaClient.ts` | read-only `/api/v1/apps` lister (SSWS auth, Link pagination; `fetch` injectable) |
| `services/discovery/appToProposal.ts` | LLM app→proposal mapper (reuses intake's pure `normalizeProposal`; LLM injectable) |
| `services/discovery/oktaDiscoveryService.ts` | orchestrator (dedupe, dry-run, audit; every collaborator injectable) |
| `modules/discovery/*` | `POST /api/v1/discovery/okta/run` |

All LLM calls go through the LiteLLM gateway (`purpose: 'analysis'`, `jsonMode`) and are Langfuse-traced.
Every collaborator is injectable, so the whole flow unit-tests with no network, model, or DB
(`tests/unittest/okta*.unit.test.ts`, `appToProposal.unit.test.ts`).

## Not in this slice

Scheduled/continuous sweeps, other source systems (AP/ERP → RTV-92), and a persisted discovery inbox
(proposals are returned for immediate confirmation, mirroring contract intake).
