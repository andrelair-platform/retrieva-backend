# ADR-0004 — ktayl-solution IS service principal: an Authentik M2M identity for Retrieva (internal dogfooding)

- **Status:** **Proposed — pending architecture + security review (Phase 0).** No code, no credentials,
  no infrastructure change has been made. Build (Phase 1+) is gated on approval of this ADR **and** on
  the Phase-3 security tests passing before any dogfood evaluation runs.
- **Updated 2026-10-26:** blockers 1–3 **VERIFIED** in code; design revised (service-typed `users` row,
  `principalType=SERVICE`, + an isolated RS256/JWKS verifier). Owner-approved (a+b) with controls; still
  **pending architecture + security sign-off** before Phase 1. No code/credentials/infra yet.
- **Date:** 2026-10-26
- **Area:** Machine-to-machine identity / authorization, multi-tenant isolation, DORA attributability.
  **Dev-only** in this ADR; production or privileged principals are explicitly out of scope here.
- **Builds on:** ADR-0002 (tool-onboarding / software-evaluation) · ADR-0003 (vendor-research egress).
  Platform process: `minicloud-gitops/.claude/rules/software-evaluation.md` (the IS adopts Retrieva as
  its evaluation tool of record; the IS is Retrieva's first internal user — the dogfooding loop).

## Context

The ktayl-solution **IS** needs to run software evaluations **in Retrieva** as a **governed tenant**, not
a throwaway retail account. For a DORA third-party-ICT tool, *who ran an evaluation* must be an
**attributable, governed organizational identity**. The requirement: a machine identity with
**short-lived, verifiable** credentials, **least privilege**, **strict tenant isolation**, and **auditable**
execution — delivered by **reusing** existing identity/authorization/isolation/audit components, **not** by
building a parallel authentication system.

> **Explicit non-goals / prohibitions (owner-directed):** no retail user account; no MFA bypass; no
> arbitrary local password; no custom API-token store; Authentik **human SSO** into Retrieva is a
> **separate future capability**, not part of this ADR.

## Decision

Reuse **Authentik OAuth2 client-credentials** as the M2M **token issuer** (short-lived JWTs). Retrieva adds
a **separate service-principal auth path** — modeled on the existing `vendorAuth` isolated-principal
pattern — that **JWKS-verifies** the Authentik token and resolves it to the IS tenant via a **server-side,
governed `client_id → service principal → organization` mapping**. Tenant isolation **reuses**
`setEntityContext`/`entityScope` (RTV-54, fail-closed). Authorization is **default-deny** by an explicit
operation→scope matrix. The IS org is provisioned idempotently with an explicit **`internal` entitlement**
(not a generic subscription bypass). Emergency revocation is a **server-side principal-active check**, not
reliance on token expiry.

## Reuse inventory — VERIFIED vs ASSUMPTION (honesty section)

**VERIFIED** (read in the current codebase):
| Component | What it does today | Evidence |
|---|---|---|
| `middleware/auth.ts` (`authenticate`) | verifies a **Retrieva-self-issued** JWT (`verifyAccessToken`), cookie or `Bearer`; idempotent (skips if `req.user`) | read |
| `middleware/requireActivePlan.ts` | `active`/`trialing`→pass; else 402; **fail-open when `req.user` absent OR `planStatus` null/undefined** | read |
| `middleware/setEntityContext.ts` + `entityScope` (RTV-54) | resolves the principal's entity scope into an AsyncLocalStorage; org-scoped repos filter synchronously; **fail-closed** `DENY_ALL` sentinel | read |
| `middleware/vendorAuth.ts` (RTV-56) | a **separate** non-staff principal (`req.vendor`), token-as-credential, **kept off the staff chain** so an external principal can never reach a staff route | read |
| `modules/evaluations/evaluations.routes.ts` | mounted `/api/v1/evaluations`, every route uses `authenticate`; ops: list/create/get, add candidate, patch scores, **select winner → promote to arrangement** | read |
| Authentik integration | **outbound discovery only** (`config/authentik.ts`, `services/discovery/authentikClient.ts` use `AUTHENTIK_API_TOKEN` to list apps) — Authentik is **not** an IdP for Retrieva's own auth | read/grep |
| role model | `role: 'user' \| 'admin'`; no service-principal type exists yet | grep |

**VERIFICATION RESULTS (2026-10-26) — blockers 1–3 cleared by reading the code; 4–6 remain:**
1. **JWT = HS256 symmetric** (`utils/security/jwt.ts`: `jwt.sign/verify` with `JWT_ACCESS_SECRET`, rotation-aware; **no asymmetric/JWKS path**). → The service path adds an **ISOLATED RS256/JWKS verifier** (`jose`/`jwks-rsa`); the **HS256 staff verifier is NOT modified** and the two never cross.
2. **`resolveEntityScope(user)` keys on `user.userId`** + `roleAssignmentRepository.findByUser(userId)`, and is **fail-closed when there is no `userId`**. → The service principal is backed by a **service-typed `users` row** (so it has a `userId` + the IS `organizationId`) with a **dedicated service role**; it must **not inherit staff/admin roles**.
3. **`evaluations.created_by` is a FK → `users.id`** (nullable, `ON DELETE SET NULL`); `authAuditService` logs **auth events only**. → Attribution reuses the service `users` row **plus** a new **append-only action-audit** carrying the immutable principal id; **disable-not-delete** preserves the link.
4. **Authentik capability** — client-credentials + JWKS + `aud`/scope: **pattern-backed** (`[[feedback_crossservice_m2m_auth_wiring]]`), confirm the exact provider config in Phase 1.
5. **NetworkPolicy** — a **separate, owner-reviewed gitops PR** (IS→Retrieva, Retrieva→Authentik-JWKS), like ADR-0003's egress.
6. **Entitlement** — add an explicit **`internal`** entitlement, **fail-closed for this tenant**; the global null fail-open is **NOT** touched here → tracked separately (see §6).

## Revised design — service-typed service principal (post-verification, APPROVED)
- A provisioned **service-typed `users` row**: **`principalType = SERVICE`** enforced at **DB + app** layers; **no password**, no MFA enrollment, no retail registration, no password reset, and it is **never issued a staff JWT**. *(A governed service identity — defined by its lifecycle/auth/authz boundaries, not by the table it sits in. It is NOT a retail account.)*
- **Auth = a separate `requireServicePrincipal` middleware** that verifies the **Authentik RS256 token via JWKS** (a NEW, isolated verifier). The **HS256 staff verifier is untouched**; a service token can never be minted or accepted by the staff path, and a staff token can never act as the service principal.
- **Exact 1:1 Authentik-client → service-principal** mapping, resolved **server-side** (never from a request/claim).
- A **dedicated least-privilege service role** (evaluation read/write only). Scope resolution recognizes **this role specifically** and **cannot inherit** staff/admin roles.
- `created_by` references the **service user's id** → FK integrity preserved.
- **Disable-not-delete** + an **immutable append-only action-audit** → attribution survives even when the principal is disabled.
- **Staff-guard exclusion:** every staff auth/authz entry point rejects a `SERVICE` row (it cannot obtain a staff JWT or pass staff authz merely by having a `users.id`); excluded from staff directory / normal user-lifecycle views.

## Migration design (schema — DESIGN ONLY, not applied until after sign-off)
- **`users.principal_type`** — enum `HUMAN`|`SERVICE`, `NOT NULL DEFAULT 'HUMAN'` (forward-only; existing rows → HUMAN). App + DB guard: a `SERVICE` row has **no `password_hash` and no MFA secret**.
- **Service role** — a dedicated `service.evaluator` role in the role-assignment model granting **only** `retrieva.evaluations:read|write` (never staff/admin); the IS principal is assigned **only** this.
- **`action_audit`** — a new **append-only** table for evaluation operations (immutable `principalId` + `actorType` + `tenantId` + `operation` + `authorizationDecision` + `result`), distinct from `authAuditService` (auth events). No UPDATE/DELETE.
- **IS org entitlement** — an explicit **`internal`** entitlement, **fail-closed** for this tenant (missing/malformed → deny, not allow); provisioned **idempotently** (get-or-create); **not assignable via public registration / customer APIs**.
- **Rollback** — feature-flag OFF reverts behaviour; the column/role/table are additive (default HUMAN) → no data loss; dropping them is a clean down-migration.

## (1) JWT validation requirements + server-side client→tenant binding
The `requireServicePrincipal` middleware MUST enforce, and reject on any failure:
- **Issuer** — exact match to the trusted Authentik issuer URL.
- **Audience** — exact match to Retrieva's expected `aud`.
- **Algorithm** — an **allow-list** (the Authentik signing alg only); reject `none` and any alg not in the list (no alg-confusion).
- **Signature** — verified against the Authentik **JWKS** (by `kid`), keys cached + refreshed.
- **Temporal** — `exp` and `nbf` validated, with a **bounded clock skew** (≤60s).
- **Scope** — the required scope(s) for the operation are present (§2).
- **Principal** — the `client_id`/`sub` maps to an **exact, active** service-principal record.
- **Tenant binding** — the tenant is resolved from a **server-side governed mapping**
  (`client_id → service principal → organizationId`), **never** from a request parameter, path, header,
  or an unverified token claim.

## (1b) Separation of duties — AI-native service vs human-in-the-loop
The evaluation process has **two actor classes**, and they get **different identities** — this is a
**control**, not a convenience:
- **AI-native service** (the service principal, this ADR) — the *automatable preparation*: discovery,
  drafting the evaluation, adding candidate vendors, computing/scoring, research enrichment (ADR-0003).
  It **proposes**.
- **Human-in-the-loop** (a governed **human user account**) — the *accountability-bearing decisions*:
  **selecting the winner**, the **risk decision**, **clause sign-off**, **approval**. A person **disposes**.

*Machine proposes, human disposes.* For a DORA third-party-risk process a **named person must own
risk-acceptance and sign-off** — the service principal must be **structurally unable** to perform them.
This enforces accountability **and** tightens the service principal's least privilege (§2).

**Human-identity boundary (named here, built later):** the HITL steps require a **governed human
account**, distinct from the service principal. For the dev dogfood those steps use a governed human
user; **Authentik human SSO** (ADR-deferred) is the eventual home for that human identity. This ADR
*builds* only the service principal and *reserves* the human actions for a human identity via the
default-deny matrix below.

## (2) Default-deny operation → scope authorization matrix
Mounting on `/api/v1/evaluations*` is **not** authorization. Each operation asserts a scope **and** an
actor class (§1b); anything unlisted is **denied**:

| Operation | Route | Actor | Service-principal scope |
|---|---|---|---|
| read evaluations | `GET /evaluations`, `GET /evaluations/:id` | AI-native service | ✅ `retrieva.evaluations:read` |
| create evaluation | `POST /evaluations` | AI-native service | ✅ `retrieva.evaluations:write` |
| add candidate | `POST /evaluations/:id/candidates` | AI-native service | ✅ `retrieva.evaluations:write` |
| score candidate | `PATCH /evaluations/:id/candidates/:cid` | AI-native service | ✅ `retrieva.evaluations:write` |
| **select winner → promote to arrangement** | `POST /evaluations/:id/select` | **human** | ❌ **default-deny** |
| **risk decision** | `PATCH /assessments/:id/risk-decision` | **human** | ❌ **default-deny** |
| **clause sign-off** | `PATCH /assessments/:id/clause-signoff` | **human** | ❌ **default-deny** |
| **approval** | `/api/v1/approvals*` (Approval Center, RTV-85) | **human** | ❌ **default-deny** |
| delete evaluation | (if present) | human | ❌ **default-deny** |
| anything else (evidence, other orgs, staff) | — | — | ❌ **default-deny** |

## (3) Revocation semantics (new-issuance vs live-JWT; emergency)
Retrieva verifies JWTs **locally**, so:
- **Client disabled in Authentik** → **new** token issuance fails; it does **NOT** invalidate an
  already-issued token.
- **A previously-issued token** → remains valid **until `exp`**. ⇒ keep TTL **short (≤10–15 min)** to
  bound the exposure window.
- **Emergency revocation (immediate)** → a **server-side principal-active check on every request**
  (resolve `client_id` → principal record; if `disabled/revoked` → deny immediately, regardless of a
  still-valid token). Disabling the principal record is the immediate lever; disabling the Authentik
  client additionally stops new tokens. (Optional hardening: a short `jti` denylist.)

## (4) Audit attribution (distinguishes service principal from human)
`createdBy` must **not** silently assume a human. Every evaluation mutation (and the **authorization
decision + outcome**, not just a successful auth) emits:
```json
{
  "actorType": "service_principal",
  "actorId": "retrieva-evaluator-ktayl-is",
  "tenantId": "ktayl-solution-is",
  "operation": "evaluation.create",
  "authenticationMethod": "oauth2_client_credentials",
  "authorizationDecision": "allow",
  "result": "success"
}
```
These are **real, consistently-resolved identifiers** in the implementation (from the verified principal,
not the request body).

## (5) Staff guards cannot accept M2M credentials (even on overlapping mounts)
- The service path is **separate**: it attaches `req.service` (not `req.user`), like `vendorAuth`. Staff
  `authenticate` only accepts Retrieva-self-issued JWTs → an Authentik M2M JWT **fails** staff verification.
- A service JWT must never reach a staff-gated route; a staff/user JWT must never be accepted as the
  service principal.
- **Acceptance = denial + no privilege escalation**, *not* a specific status code: a service JWT on a
  staff route may correctly get **401** (staff middleware doesn't recognize the token) **or 403**; both are
  acceptable. Test asserts **denial + absence of escalation**, not the exact code. (403 is reserved for
  *authenticated-but-unauthorized*.)

## (6) Internal entitlement semantics (no generic subscription bypass)
- Add an **explicit** `planStatus: 'internal'` (an entitlement, not a Stripe state) that **only the
  provisioner** sets, on **internal** orgs only, and `requireActivePlan` passes it **deliberately**.
- **Fail-closed for this tenant:** a missing/malformed entitlement record → **deny**, never allow.
  `internal` is set **only** by the provisioner and is **not** assignable via public registration / customer APIs.
- **Do not** touch the **global** null/undefined fail-open here — that needs a dependency/impact analysis
  first. It is **separately tracked** (issue **#156**) — dependency analysis + migration + regression
  tests — a controlled migration, **not** permanent acceptance of the fail-open.
- `internal` grants access to the **evaluation scope only** (combined with §2), not blanket paid features.

## (7) Governance (dev lightweight / prod dual-approval)
| Situation | Governance |
|---|---|
| **This** dev-only, evaluation-scoped IS principal | **named owner + security review + recorded approval** (this ADR) |
| Production M2M principal | **ktayl-iam dual approval** |
| Privileged / cross-tenant principal | dual approval + elevated security review |
| Credential rotation | automated within the approved policy |
| Revocation / emergency disable | **immediate, without waiting for dual approval** |

Vault/ESO **protects** the credential; it does **not** approve **entitlement**. Entitlement is approved here
(dev) / by ktayl-iam dual approval (prod/privileged).

## (8a) Threat model (STRIDE-lite)
Trust boundary: **IS workload → Authentik (issuer) → Retrieva (verifier)**; and tenant boundary inside Retrieva.
| Threat | Mitigation |
|---|---|
| **Spoofing** (forged/alien token) | exact `iss`+`aud`, alg allow-list, JWKS signature, active-principal check |
| **Tampering** | signature verification; TLS in transit |
| **Repudiation** | the §4 audit record (actor type + authz decision + outcome) |
| **Information disclosure** (cross-tenant) | `entityScope` fail-closed + server-side tenant binding + least scope |
| **DoS** | rate-limit the service path (reuse the existing limiter pattern) |
| **Elevation** (reach staff routes / scope creep) | principal separation (§5) + default-deny matrix (§2) |
| **Stale-token-after-revoke** | short TTL + immediate principal-active check (§3) |
| **SSRF/egress** (if evaluation triggers research) | out of scope here; governed by ADR-0003 |

## (8b) Rollback
The service-principal path is **feature-flagged OFF by default**. Rollback = flag off + delete the Authentik
client + remove the Vault secret → reverts with **no impact on staff auth** (untouched) or existing tenants.
Dev-only; no prod surface.

## (8c) Ownership & lifecycle
- **Owner:** ktayl-solution IS (compliance/DSI persona).
- **Environments:** **dev only** (prod/privileged needs a separate dual-approval ADR).
- **Expiry / recertification:** periodic recert of the principal (≤90 days); creds rotated on policy.
- **Offboarding:** disable the principal record → disable the Authentik client → remove the Vault secret.
- **Emergency revoke:** disable the principal record (immediate, §3).

## (8d) Acceptance criteria (the Phase-3 gate — must be green before any dogfood)
**Positive:** a valid short-lived **service** token → create/read/score an evaluation + add candidates,
**scoped to the IS org**, **attributed** as a `service_principal` in the action-audit. **A human account**
(not the service principal) performs **select-winner / risk-decision / sign-off / approval** (SoD, §1b).
**Negative:**
1. **Expired** token → denied (401).
2. **Client disabled** → new token issuance fails; a still-valid issued token behaves per §3 (document the TTL window).
3. **Emergency revoke** (principal record disabled) → **immediate** denial even with a still-valid token.
4. **Insufficient scope** → denied (e.g. `select`/`risk-decision`/`sign-off`/`approval` are human-only → service denied; `delete` not granted → denied).
5. **Cross-tenant** → IS principal requests another org's evaluation → `entityScope` denies (not-found/forbidden).
6. **Staff-route reach** → service JWT on a staff route → **denied + no escalation** (401 or 403 acceptable).
7. **Reverse** → a user/staff JWT is **not** accepted as the service principal.
8. **No staff JWT from a service row** — a `SERVICE` `users` row can **not** obtain a staff JWT nor pass any staff auth/authz entry point (asserted at **every** staff guard).
9. **No staff-role inheritance** — the service role resolves to evaluation scopes **only**; it cannot inherit a staff/admin role despite being a `users` row.
10. **Entitlement fail-closed** — the IS tenant with a missing/malformed entitlement → **denied**; `internal` cannot be set via public registration.
11. **Attribution survives disable** — disabling (not deleting) the principal preserves `created_by` + the append-only action-audit's immutable principal id.

## Consequences
- **Positive:** governed, auditable, tenant-isolated, reuses platform identity (no parallel auth system);
  honest DORA attributability; a clean dogfooding relationship (IS ↔ Retrieva).
- **Cost / negative:** a new auth path to maintain; dev issuance depends on Authentik availability; the
  pre-existing `requireActivePlan` null fail-open should be hardened as part of this.

## Security-review status (the SA/SEC sign-off on this updated ADR is the remaining gate)
1. **RESOLVED** — JWT is HS256 symmetric; add an **isolated** RS256/JWKS verifier (staff HS256 untouched).
2. **RESOLVED** — `entityScope` keys on `userId` + role assignments (fail-closed); the principal = a
   service-typed `users` row with a **dedicated** service role, **no staff-role inheritance**.
3. **RESOLVED** — `created_by` FK→`users` (nullable) + a new **append-only action-audit**; disable-not-delete.
4. **DECIDED** — explicit **`internal`** entitlement (fail-closed for the tenant); global null-hardening =
   a **separately tracked** issue.
5. **Prepared separately** — the NetworkPolicy openings = an **owner-reviewed gitops PR** (not in this repo).
6. **Approved** — dev-lightweight governance (named owner + security review + recorded approval).

**Remaining gate:** architecture + security **sign-off on this updated ADR**, then the §8d test matrix
green **before** any dogfood. No Phase-1 code/credentials/infra until sign-off.

## Deployment status — DEV (as-built, 2026-10-27)
All five build increments (#158–#162) are merged to `main` and **live on the dev environment**; the
runtime is provisioned on **dev only** (prod renders none of it). What is live:
- **Authentik** — OAuth2/OIDC M2M client `retrieva-is-evaluator` (app slug `retrieva-is-evaluator`),
  `grant_types: [client_credentials]`, created via `ak-shell` (mirrored ktayl-policy-service). The
  `client_id` is the token `aud`/`azp`; `client_secret` held by the IS caller (see Vault note below).
- **Verifier config (dev)** — `AUTHENTIK_M2M_{ISSUER,JWKS_URL,AUDIENCE}` added to
  `minicloud-gitops/services/retrieva/helm/values-dev.yaml` (gitops PR #1983, merged + live). JWKS is
  fetched in-cluster over the existing `authentik:9000` egress the RTV-91 discovery connector opens — **no
  new NetworkPolicy** (the §proposal-5 opening was unnecessary; verified against the live netpol).
- **Image** — dev runs `retrieva-backend:70eb730` (main HEAD = all 5 increments), promoted by **Kargo**
  (Freight `7fba666`, auto-merged dev PR #1987). Migration **0032+0033 applied** on boot
  (`drizzle.__drizzle_migrations` = 34; `users.external_client_id` present).
- **Dev tenant seeded** — via the committed reusable seed `scripts/seedIsEvaluator.ts`
  (`npm run seed:is-evaluator`, #163): a SERVICE principal (`principal_type=SERVICE`,
  `platform_admin=false`, passwordless, `external_client_id` = the client_id), a **self-owned internal
  org** `ktayl-solution IS` (`plan_status=internal`), and the single `service_evaluator` grant @ entity
  scope. Org ownership confers **no** evaluation capability — SoD stays with the capability map (§2) + the
  principal-type guard (§5).

**Still pending (deliberate):**
- **Dogfood (§8d) NOT run** — awaiting the security sign-off + the §8d acceptance matrix green.
- **Vault storage of the IS caller credential** — `secret/platform/*` writes need the **break-glass root
  token** (the scoped ops token is expired; recover per `ops-runbooks`, root never to automation). A human
  step; not required for the dev proof (the caller mints its token directly from the client credentials).

Related: `minicloud-gitops/.claude/rules/software-evaluation.md`, ADR-0002, ADR-0003,
`[[feedback_crossservice_m2m_auth_wiring]]`, `[[project_iam_custom_access_governance]]`,
`[[reference_bff_auth_shared_lib]]`, `platform-guardrails:authentik-app-onboarding` (the M2M wiring skill).
