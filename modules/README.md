# `modules/` — modular-monolith feature modules

Retrieva's backend is a **modular monolith**: one deployable Node/Express app, but the
code is organised by **business capability** rather than by technical layer. Each module
is a high-cohesion, low-coupling unit that owns its HTTP surface and talks to the **shared**
service/data layer.

## Why modular monolith (not microservices)

- **Single deploy artifact** — one image, one `retrieva-backend` service, no inter-service
  network calls or distributed-transaction complexity.
- **Clear boundaries + SRP** — each capability has one reason to change; a change to
  `concentration` doesn't ripple into `billing`.
- **Scales the codebase, not the ops** — we get separation of concerns and independent
  reasoning per domain while keeping the simplicity of a monolith. If a capability ever
  needs to become its own service, its module is already the seam to extract along.

## Module shape (reference: `concentration/`)

```
modules/<capability>/
  <capability>.routes.ts       # the Router (mounted in app.ts)
  <capability>.controller.ts   # HTTP handlers (typed req/res), thin — orchestrate only
  <capability>.schema.ts       # Zod request validation (params/query/body) + inferred types
  <capability>.types.ts        # domain response types
```

Rules:
- The module owns **routes + controller + schema + types**. It calls the **shared**
  `services/` (business logic) and `repositories/` / `db/` (data) — those stay app-wide so
  domains can reuse them (high cohesion within a module, low coupling across modules).
- Cross-module calls go **through a shared service**, never by importing another module's
  controller/routes. That keeps boundaries clean and the dependency graph acyclic.
- Path-param and query validation live in `<capability>.schema.ts` using the shared
  helpers in `validators/params.ts` (`idParam`, `workspaceIdParam`, `numberQuery`, …).

## Migration status (RTV-23 → RTV-24)

`concentration` is the **first extracted module** (the reference). The rest of the Express
layer is typed **in place** under `routes/` + `controllers/` this pass; each domain below is
a candidate to graduate into `modules/<domain>/` as it's touched:

| Capability | Status | Source |
|---|---|---|
| concentration | ✅ module | `modules/concentration/` |
| auth · workspace · assessment · rag · billing · questionnaire · compliance · organization · conversation · health | typed in place | `routes/` + `controllers/` |

Extract a domain into a module when you're already changing it — don't do a big-bang move.
