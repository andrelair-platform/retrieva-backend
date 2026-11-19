# retrieva-backend

[![CI](https://github.com/andrelair-platform/retrieva-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/andrelair-platform/retrieva-backend/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-20-blue)](https://nodejs.org)
[![Supply chain: cosign](https://img.shields.io/badge/supply%20chain-cosign%20signed-green)](https://github.com/sigstore/cosign)

> The Retrieva backend — a Node/ESM Express API providing the evidence-grounded RAG and DORA
> third-party-risk (TPRM) assessment engine behind [Retrieva](https://github.com/andrelair-platform/retrieva),
> the RNCP39583 certification product. It runs self-hosted on the ktayl-solution minicloud
> (k3s) platform, on PostgreSQL + Drizzle, Qdrant, Redis/BullMQ, and LangChain through the
> LiteLLM gateway, with Langfuse tracing.

**Frontend repo:** <https://github.com/andrelair-platform/retrieva>
**Platform docs:** <https://andrelair-platform.github.io/minicloud-platform-docs/>

---

## Table of Contents

- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [CI/CD Pipeline](#cicd-pipeline)
- [Endpoints](#endpoints)
- [Environment variables](#environment-variables)
- [Database migrations](#database-migrations)
- [Contributing](#contributing)
- [License](#license)

## Architecture

Split out of the Retrieva monorepo (RFC #474): the frontend stays in `retrieva`, the backend
lives here and releases independently.

Product-level **C4 container view** (this backend + the frontend + datastores + governed AI platform),
generated from code ([`retrieva/docs/diagrams/retrieva_container.py`](https://github.com/andrelair-platform/retrieva/blob/main/docs/diagrams/retrieva_container.py), mingrammer `diagrams`):

![Retrieva — C4 container view](https://raw.githubusercontent.com/andrelair-platform/retrieva/main/docs/static/img/architecture/retrieva-container.png)

Delivery pipeline for this repo:

```
 push main ──▶ GitHub Actions (build.yml)
              │ build ─▶ ghcr.io/andrelair-platform/retrieva-backend:<sha>
              │ cosign keyless sign + CycloneDX SBOM (main)
              ▼
        Kargo (minicloud-gitops)  ── git Warehouse ─▶ dev Stage (auto) ─▶ prod Stage (CODEOWNERS)
              ▼
        ArgoCD ─▶ retrieva-{dev,prod} (k3s)
```

> Registry note: **ghcr.io is the only registry** (dev + prod); Harbor was decommissioned
> (2026-11-16). Kargo uses a **git Warehouse** (Freight keyed on the commit SHA) because Retrieva is a
> multi-image product (backend + frontend + crew) promoted together as a product release.

| Concern | Choice |
|---|---|
| Runtime | Node.js 20 (ESM, `"type": "module"`) |
| Framework | Express 5 |
| Database | PostgreSQL + Drizzle ORM (drizzle-kit migrations) |
| Vector store | Qdrant |
| Queue / cache | Redis + BullMQ |
| LLM | LangChain via the LiteLLM gateway; Langfuse tracing |
| Registry | ghcr.io (dev + prod, SHA-pinned) — Harbor decommissioned 2026-11-16 |
| GitOps | ArgoCD + Kargo (`minicloud-gitops/services/retrieva`) |

## Getting Started

```bash
npm ci --legacy-peer-deps
npm run typecheck          # tsc --noEmit (allowJs baseline — code is still JS)
npm run lint
npm run test               # vitest unit + integration (integration uses testcontainers)
npm run dev                # nodemon on index.js (Sentry/OTel via --import ./instrument.js)
npm start                  # node --import ./instrument.js index.js
docker build -t retrieva-backend .
```

Copy `.env.example` → `.env` and fill in local values. Production env is SOPS-encrypted
(`.env.production.enc`) and delivered in-cluster via ESO/Vault — never committed in plaintext.

## CI/CD Pipeline

- **`ci.yml`** (push/PR to main): lint + `tsc --noEmit` + vitest L0–L2 (Postgres + Redis services; integration uses a real Postgres) + a Docker build check.
- **`build.yml`** (push to main): build + push to ghcr, cosign keyless sign + CycloneDX SBOM.
- **`release.yml`**: release-please opens/merges release PRs (SemVer from conventional commits).
- **`bmad-sync.yml`**: syncs backend-scoped BMAD stories to GitHub Issues (Retrieva board #2).

Deployment is GitOps — Kargo promotes the `main` image dev→prod; prod is CODEOWNERS-gated in
`minicloud-gitops`. Nothing deploys over SSH.

| Secret | Purpose |
|---|---|
| `MINICLOUD_CA_CERT` | baked into the image at build (CA trust) via a `CA_CERT` build-arg |
| `GITOPS_TOKEN` | `write:packages` PAT (ghcr push where the package is linked to minicloud-gitops) |
| `GPG_PRIVATE_KEY` | signed commits / artifacts |

## DORA capabilities (the TPRM engine)

Retrieva covers the **financial entity's side of DORA Pillar 4 (ICT third-party risk management)** —
the arrangement graph *is* the Register of Information, and the lifecycle (discover → classify & assess
→ evidence & decide → register & monitor) is a coherent, human-in-the-loop workflow. Notable engine
capabilities:

- **Evidence-grounded assessment** — control-library-driven gap analysis (AI drafts, cited; a human
  checker decides under maker≠checker SoD) + the agentic supervisor/CrewAI orchestration.
- **Register of Information** — RT.01–04 + B_01/02 projection with completeness auditing, and **ESA
  data-quality checks** (LEI ISO 17442 + ISO 7064 checksum, ISO 3166 country, cross-template
  referential integrity — traced to ITS 2024/2956).
- **Intelligent finding routing** — an approved gap is routed to the owning party by control domain
  (security / DPO / legal / ICT-risk), escalating to the management-body delegate on a severe
  critical/important finding, and the holders are notified.
- **Event-driven re-assessment** — a material change (subprocessor added/removed, data-residency move)
  on re-ingestion reopens the arrangement for a fresh assessment (the change trigger, twin of the
  periodic cadence).
- **Audit readiness** — an on-demand, tamper-evident **evidence pack** per arrangement + a readiness
  **dashboard** (overdue reassessments, evidence freshness, register coverage, upcoming deadlines).
- **Continuous monitoring** — CTPP surveillance (status-page incidents + CVE feeds) + periodic
  re-assessment.

## Endpoints

The full, authoritative API surface is the auto-generated OpenAPI spec — **Swagger UI at `/api-docs`**
(JSON at `/api-docs.json`). A non-exhaustive map of the main areas:

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness/readiness probe |
| * | `/api/v1/auth/**` | Authentication (login, refresh, MFA, sessions) |
| * | `/api/v1/arrangements/**` | Arrangement graph CRUD + governed intake (propose → check → approve) |
| * | `/api/v1/assessments/**`, `/api/v1/assessment-runs/**` | Control assessment + agentic runs |
| * | `/api/v1/decision-queue/**` | Decision inbox — draft findings + open risks (carries the routed role) |
| * | `/api/v1/register/**` | Register of Information projection + export (RT.01–04) |
| * | `/api/v1/register-completeness/**` | Register data-quality audit (incl. the ESA checks) |
| * | `/api/v1/surveillance/**` | CTPP surveillance events (incidents, CVEs) |
| GET | `/api/v1/reportability/dashboard` | Audit-readiness dashboard (overdue / freshness / coverage / deadlines) |
| GET | `/api/v1/reportability/audit-pack/:arrangementId` | On-demand, tamper-evident audit evidence pack |
| * | `/api/v1/reportability/**` | RoI reportability determinations (append-only, human-only) |
| GET | `/api-docs`, `/api-docs.json` | Swagger/OpenAPI UI + spec |

## Environment variables

See `.env.example` for the full list. Key ones: `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `QDRANT_URL`, `LITELLM_*`, `LANGFUSE_*`.

## Database migrations

Drizzle Kit (`drizzle.config.js`):

```bash
npm run db:generate   # generate SQL from schema changes
npm run db:migrate    # apply migrations
npm run db:studio     # Drizzle Studio
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Conventional Commits enforced (commitlint); NodeNext ESM —
relative imports need explicit `.js` extensions even in `.ts` source.

## License

[MIT](LICENSE) © andrelair-platform
