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

```
 push main ──▶ GitHub Actions (build.yml)
              │ build ─▶ Harbor (dev)  +  ghcr.io/andrelair-platform/retrieva-backend:<sha>
              │ cosign sign + SBOM (main)
              ▼
        Kargo (minicloud-gitops)  ── image Warehouse ─▶ dev Stage (auto) ─▶ prod Stage (CODEOWNERS)
              ▼
        ArgoCD ─▶ retrieva-{dev,prod} (k3s)
```

| Concern | Choice |
|---|---|
| Runtime | Node.js 20 (ESM, `"type": "module"`) |
| Framework | Express 5 |
| Database | PostgreSQL + Drizzle ORM (drizzle-kit migrations) |
| Vector store | Qdrant |
| Queue / cache | Redis + BullMQ |
| LLM | LangChain via the LiteLLM gateway; Langfuse tracing |
| Registry | Harbor (dev) + ghcr (prod, SHA-pinned) |
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

- **`ci.yml`** (push/PR to main): lint + `tsc --noEmit` + vitest (Postgres + Redis services) + a Docker build check.
- **`build.yml`** (push to main): dual-push Harbor + ghcr, cosign keyless sign + CycloneDX SBOM.
- **`release.yml`**: release-please opens/merges release PRs (SemVer from conventional commits).
- **`bmad-sync.yml`**: syncs backend-scoped BMAD stories to GitHub Issues (Retrieva board #2).

Deployment is GitOps — Kargo promotes the `main` image dev→prod; prod is CODEOWNERS-gated in
`minicloud-gitops`. Nothing deploys over SSH.

| Secret | Purpose |
|---|---|
| `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET` | Tailscale access to Harbor (org-level) |
| `MINICLOUD_CA_CERT` | trust the minicloud CA for Harbor TLS |
| `HARBOR_USER` / `HARBOR_PASSWORD` | Harbor push (org-level) |

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness/readiness probe |
| * | `/api/v1/**` | Application API (auth, RAG, assessments, conversations) |
| GET | `/api-docs` | Swagger/OpenAPI UI |

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
