# ADR-0004 — ktayl-solution IS service principal: an Authentik M2M identity for Retrieva (internal dogfooding)

- **Status:** **Proposed — pending architecture + security review (Phase 0).** No code, no credentials,
  no infrastructure change has been made. Build (Phase 1+) is gated on approval of this ADR **and** on
  the Phase-3 security tests passing before any dogfood evaluation runs.
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

**ASSUMPTION** (must be verified during Phase 1 — these are security-review inputs, not facts):
1. **JWT algorithm** — `utils/security/jwt.js` was **not** read; whether a second **RS256/JWKS** verifier slots in cleanly (vs an HS256-only setup) is **unverified**.
2. **Non-user scope resolution** — `resolveEntityScope` reads `req.user.userId`; whether it can resolve a **non-user service principal** to the IS entity scope is **unverified** (likely needs a code path).
3. **Audit/model fields** — whether `createdBy` / the evaluation + audit schema **assume a human user** is **unverified** (the schema was not read); may need a principal-type field.
4. **Authentik capability** — client-credentials grant + JWKS + `aud`/scope claims being available/configurable for Retrieva is **pattern-backed** (works for other platform services, `[[feedback_crossservice_m2m_auth_wiring]]`) but **not verified** for this app.
5. **NetworkPolicy** — IS-workload→Retrieva and Retrieva→Authentik-JWKS egress on the default-deny cluster is **unverified**.
6. **Entitlement** — `requireActivePlan` has **no `internal` status today**; adding it is new. The **null/undefined fail-open exists** — relying on it would be the "generic subscription bypass" risk this ADR forbids.

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
- **Do not** rely on the existing null/undefined **fail-open** — that is a generic bypass. This ADR
  flags hardening it (fail-open → require an explicit entitlement) as part of the work.
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
**Positive:** a valid short-lived token → create/read/score an evaluation **and** select a winner, **scoped
to the IS org**, **attributed** as a service principal in the audit.
**Negative (corrected):**
1. **Expired** token → denied (401).
2. **Client disabled** → new token issuance fails; a still-valid issued token behaves per §3 (document the TTL window).
3. **Emergency revoke** (principal record disabled) → **immediate** denial even with a still-valid token.
4. **Insufficient scope** → denied (e.g. no `:select` → 403; `delete` not granted → denied).
5. **Cross-tenant** → IS principal requests another org's evaluation → `entityScope` denies (not-found/forbidden).
6. **Staff-route reach** → service JWT on a staff route → **denied + no escalation** (401 or 403 acceptable).
7. **Reverse** → a user/staff JWT is **not** accepted as the service principal.

## Consequences
- **Positive:** governed, auditable, tenant-isolated, reuses platform identity (no parallel auth system);
  honest DORA attributability; a clean dogfooding relationship (IS ↔ Retrieva).
- **Cost / negative:** a new auth path to maintain; dev issuance depends on Authentik availability; the
  pre-existing `requireActivePlan` null fail-open should be hardened as part of this.

## Open security-review blockers (SA/SEC must resolve before Phase 1)
1. Confirm the **JWT alg / JWKS** feasibility (ASSUMPTION 1) — read `utils/security/jwt.js`.
2. Confirm **`entityScope` can resolve a non-user principal** (ASSUMPTION 2).
3. Confirm the **audit/evaluation model** can carry a principal type (ASSUMPTION 3).
4. Decide the **null fail-open hardening** in `requireActivePlan` (§6).
5. Confirm the **NetworkPolicy** openings (ASSUMPTION 5) — a separate, deliberate gitops change (like ADR-0003's egress).
6. Approve the **dev-lightweight governance** (§7) for this principal.

Related: `minicloud-gitops/.claude/rules/software-evaluation.md`, ADR-0002, ADR-0003,
`[[feedback_crossservice_m2m_auth_wiring]]`, `[[project_iam_custom_access_governance]]`,
`[[reference_bff_auth_shared_lib]]`, `platform-guardrails:authentik-app-onboarding` (the M2M wiring skill).
