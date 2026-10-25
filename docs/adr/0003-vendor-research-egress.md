# ADR-0003 — Public-research enrichment agent + its egress boundary (with threat model)

- **Status:** Accepted — backend built DEFAULT-OFF (flag + app allow-list + SSRF guard + HITL). The
  cluster egress opening (Cilium FQDN netpol) is a SEPARATE, deliberate gitops change the owner merges
  to actually enable fetching.
- **Date:** 2026-10-25
- **Area:** Third-party onboarding enrichment (ADR-0002 E5); DORA Art. 28(4) pre-contractual due
  diligence. Security: egress boundary on the default-deny cluster.

## Context

The adoption/evaluation flow (ADR-0002) drafts a vendor's arrangement from the stated need; vendor
facts (sub-processors, data residency) stay `null` → `insufficient_evidence` unless a human uploads
the vendor's documents. E5 offers the alternative: let an agent **fetch the vendor's own public
trust-centre / sub-processor page** and pre-fill those facts (still unconfirmed).

This is the **only** path in Retrieva that reaches the public internet. The backend runs under
**default-deny egress** (netpol allows only DNS + the LiteLLM gateway + Qdrant + same-ns datastores —
[[feedback_llm_governance_egress_policy]]). A naïve "fetch a user-supplied URL" is a classic **SSRF**
primitive (cloud metadata `169.254.169.254`, internal services, loopback). So the capability is gated
and guarded deliberately.

## Decision

Build the agent **safe-by-default and double-gated**; opening the boundary is an explicit act.

1. **App flag (default OFF):** `ENABLE_VENDOR_RESEARCH` must be exactly `true`. Off → the route 403s
   and no fetch is attempted (`config/vendorResearch.ts`).
2. **Curated domain allow-list:** only registrable domains of known vendors (and their subdomains,
   e.g. `trust.notion.so`) may be fetched; env-extendable (`VENDOR_RESEARCH_ALLOWLIST_EXTRA`).
3. **Pure SSRF/allow-list guard BEFORE connecting** (`services/research/urlGuard.ts`,
   `isAllowedResearchUrl`): https-only · no embedded credentials · default port only · **reject
   IP-literal hosts** (blocks metadata/loopback) · host must equal-or-be-a-subdomain of an allow-listed
   domain (dot-boundary match, so `evilnotion.so` and `notion.so.evil.com` are rejected).
4. **Guarded fetch** (`vendorResearch.ts`): `redirect: 'manual'` — a 3xx is **rejected**, never
   auto-followed off the allow-list; `AbortController` timeout; `content-length` + streamed byte cap;
   HTML stripped to text before extraction.
5. **Reuse the honest extractor:** the fetched text is fed to `proposeFromAdoptionRequest` — same
   gap-aware logic, so facts not present stay `null`. Output is **UNCONFIRMED** with **provenance**
   (source URL + host + fetched size); the human merges it (HITL). Nothing is persisted or auto-applied.
6. **Cluster egress (the boundary opening) is SEPARATE gitops:** a Cilium **FQDN** egress policy
   (`toFQDNs`) pinning exactly the allow-listed hostnames (+ DNS). Until it is merged, even with the
   flag on the fetch simply times out (handled as a soft failure). The netpol PR is where the owner
   consciously accepts the boundary — it is not bundled with this code.

## Threat model (STRIDE-lite on the new egress surface)

| Threat | Vector | Mitigation |
|---|---|---|
| **SSRF → cloud metadata / internal svc** | user supplies `https://169.254.169.254/…` or an internal host | IP-literal hosts rejected; allow-list is public vendor domains only; Cilium FQDN netpol pins destinations (a non-allow-listed host has no egress route at all) |
| **Allow-list bypass via look-alike** | `evilnotion.so`, `notion.so.evil.com` | dot-boundary suffix match (`host === d || host.endsWith('.'+d)`) |
| **Open redirect → off-list host** | allow-listed URL 302s to an internal/evil host | redirects are rejected (`redirect: 'manual'`), never followed |
| **DNS rebinding** | an allow-listed name resolves to a private IP | **residual** at the app layer (global `fetch` has no pre-connect IP hook) → mitigated at the cluster by the Cilium FQDN policy, which resolves + pins allowed IPs; compensating: HITL + provenance + no auto-apply |
| **Resource exhaustion** | hostile huge/slow response | timeout + `content-length` check + streamed byte cap |
| **Data exfiltration via the fetch** | the request path leaking tenant data outbound | GET only, no body, no tenant data in the URL (vendor + source URL only); egress limited to the pinned FQDNs |
| **Tampering / false facts** | a page lies about sub-processors | output is unconfirmed + provenanced; a human confirms; the assessment still runs on real evidence |
| **Credentials leak** | `user:pass@host` in the URL | embedded credentials rejected by the guard |

**Residual risks (accepted, documented):** DNS-rebinding at the app layer (compensated by the FQDN
netpol + HITL); the allow-list is trust-on-first-use for the listed domains (we trust a vendor's own
trust page). Revisit if the feature is ever used to fetch non-trust-page content or arbitrary domains.

## Consequences
- **Positive:** the "just type Notion" enrichment becomes real without weakening the default-deny
  posture for anything else; the dangerous half (egress) is isolated to one reviewed netpol PR; the
  honest-by-construction + HITL contract is preserved (provenance, unconfirmed, no auto-apply).
- **Negative:** a curated allow-list needs maintenance as vendors are added; the app-layer DNS-rebinding
  gap means the Cilium FQDN policy is load-bearing (don't enable the flag without it).
- **Cert (BC03 déployer & sécuriser):** this ADR + the threat model + the double-gate are the evidence
  that a new external boundary was opened under an explicit, defensible security process.

## References
- `config/vendorResearch.ts` (flag + allow-list), `services/research/urlGuard.ts` (pure SSRF guard),
  `services/research/vendorResearch.ts` (guarded fetch + reuse of the extractor),
  `POST /api/v1/arrangements/intake/research`. Tests: `tests/unittest/urlGuard.unit.test.js`,
  `tests/unittest/vendorResearch.unit.test.js`. Extends ADR-0002 (tool onboarding).
