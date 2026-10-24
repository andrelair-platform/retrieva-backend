# ADR-0002 — "Onboard a new tool" = a software-evaluation workflow, with Retrieva owning the DORA/security/legal spine

- **Status:** Accepted — building (E1 decision pack → E2 evaluation core → E3 legal clause pack → E4 frontend).
- **Date:** 2026-10-24
- **Area:** Third-party ICT onboarding / procurement; DORA Art. 28(4) (pre-contractual assessment) + Art. 30 (contractual clauses) + Art. 29 (concentration). RTV-31/34/36/41.

## Context

"Onboarding a new SaaS/tool" in an enterprise is not a single step — it is the **software-evaluation
process**: define the need → set weighted criteria → shortlist 2–3 vendors → demo/PoC + **security
audit** → TCO/SLA + **select** → **contract**. Retrieva already has the pre-contractual lifecycle
(`prospect → due_diligence → active`, ADR §6), the assessment engine, concentration (ADR-0001), exit
strategy, and a contract control-library + clause mapper (RTV-40). What it lacked was (a) a **forward,
need-first** entry (not just contract-first intake or shadow-IT discovery), (b) a way to **compare
candidate vendors**, and (c) the **legal clause deliverable** for the contract.

A naïve reading would make Retrieva a general procurement tool (full functional/UX/TCO scoring). That
dilutes it. Retrieva's **differentiated, defensible** value is the **DORA + security + concentration +
legal-clause spine** — the lanes it can *auto-score* and *auto-generate* from real evidence and the
control library. The generic procurement lanes (functional fit, ease-of-use, TCO) are buyer judgement.

## Decision

**Model tool-onboarding as an `evaluation` that compares candidate vendors on a two-lane scoring model,
then promotes the winner into the existing arrangement lifecycle.**

1. **New concept — `evaluation` (sourcing request) + `evaluation_candidates`.** An evaluation holds the
   business **need** once and 1..N **candidate vendors**. Each candidate reuses the need-first adoption
   proposal (`proposeFromAdoptionRequest`, PR #149). Today `1 arrangement = 1 chosen vendor`; the
   evaluation is the *pre-selection* parent that did not exist. The **winner is promoted** to a real
   arrangement via `confirmProposal(trigger='new')` → it enters `prospect` and the normal due-diligence
   lifecycle. Non-winners are recorded (audit/why-not), never promoted.

2. **Two-lane weighted scoring — the ownership boundary.**
   - **Auto lane (Retrieva owns):** DORA assessment verdicts, security/evidence coverage, concentration
     impact. Scored from real signals, not opinion.
   - **Manual lane (buyer owns):** functional fit, ease-of-use, TCO/commercial. Entered with weights;
     Retrieva hosts them but does **not** pretend to auto-evaluate them.
   The ranked compare is the weighted blend. This boundary is the product's honesty line.

3. **Legal is a first-class output, not a side effect (Art. 30).** At due-diligence Retrieva emits the
   **mandatory contractual-clause pack** for the legal team — derived from the control library
   (`doraArticleRef`), **criticality-tiered** (Art. 30(2) for all arrangements; Art. 30(3) extras for
   CIFs: audit rights, sub-outsourcing conditions, exit strategies, incident reporting) — and
   **gap-checks** an uploaded draft contract against it (covered / missing / weak), reusing the RTV-40
   clause→control mapper. Legal gets a punch-list, not a blank page.

4. **Human holds the gate (SoD).** Every terminal decision stays human: select-the-winner, and the
   `approve_onboarding` / `reject` lifecycle transition (checker ≠ the analyst who ran the assessment).
   Retrieva assembles an advisory **onboarding decision pack** (assessment roll-up + concentration
   signal + exit posture + the gate); it recommends, it does not decide.

## Phased plan

- **E1 — onboarding decision pack** (`GET /arrangements/:id/onboarding-decision`) — assembles the
  pre-contract signals for the approve/reject gate. Pure assembler + endpoint. *(independent; ships first)*
- **E2 — evaluation core** — the `evaluation`/`evaluation_candidates` tables, the two-lane scoring,
  select → promote. (Migration + ERD regen on x86.)
- **E3 — legal clause pack + gap-check** — Art. 30 required-clause pack + draft-contract gap-check.
- **E4 — frontend** — the evaluation workbench + the arrangement due-diligence view.
- **E5 — public-research enrichment agent** — egress-gated, deferred (own netpol + threat-model touch).

## Consequences

- **Positive:** a complete, DORA-authentic onboarding journey (need → compare → audit → select →
  contract) that stays focused on Retrieva's moat; the evaluation parent cleanly precedes the
  arrangement without disturbing the existing lifecycle; legal gets a concrete, grounded deliverable.
- **Negative / risk:** a new domain concept (evaluation) + schema; the auto/manual scoring boundary
  must be communicated clearly in the UI or buyers over-trust the blended score. Keep the lanes visually
  separate and label auto-scores with their evidence.
- **Honest-by-construction carries over:** vendor facts not in evidence stay `insufficient_evidence`
  (PR #149); auto-scores cite their signals; the clause gap-check flags *weak*, not just missing.

## References
- Adoption request (need-first intake): `services/intake/adoptionRequestService.ts` (PR #149).
- Lifecycle: `services/lifecycle/arrangementLifecycle.ts`. Concentration: ADR-0001. Clause mapper:
  `services/assessment/clauseMapping.ts` + `services/intake/controlTouchpoints.ts` (RTV-40).
