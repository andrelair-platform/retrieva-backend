# ADR-0006 — AI-native assessment orchestration & Human-in-the-Loop (HITL) boundaries

- **Status:** **Proposed — DOCUMENT ONLY.** No code, no agents, no schema, no deploy. Build is gated on
  approval of this ADR **and** on ADR-0005 (the data model these agents reason over) being decided first.
- **Date:** 2026-10-27
- **Area:** AI orchestration, human-in-the-loop governance, DORA accountability (Art. 5 board/risk-owner
  accountability; Art. 28 third-party-ICT), LLMOps. **Dev-first.**
- **Builds on:** ADR-0004 (SoD + `principalType` guard + append-only `action_audit`) · ADR-0005 (ICT
  asset / third-party-service / arrangement / **reportability determination** — the state the agents
  propose and humans decide) · the discovery connectors (RTV-91 Authentik / RTV-92 ERPNext) + the
  register-completeness engine. Platform: `llmops.md` (per-product Langfuse tracing + managed prompts),
  `software-evaluation.md`, `[[reference_retrieva_ai_native_dora]]`.

## Context

Retrieva is an **AI-native ICT-risk & regulatory-compliance platform**: AI drives the assessment
lifecycle (discover → reason → classify → execute → monitor); **humans retain authority over material
risk and regulatory decisions**. DORA mandates explicit operational accountability at the management-board
and risk-owner level (Art. 5, Art. 28), so **fully autonomous** decision-making introduces compliance
risk, regulatory liability, and record-integrity risk (a hallucinated entry in a legally-binding RoI).
This ADR fixes *which* actions an agent may take autonomously, *which* require a human, and *how* the
boundary is enforced + audited. It is the orchestration/governance layer; **ADR-0005 is the model it acts
on** — they are intentionally separate (data model vs who-may-change-it-and-how).

## Decision drivers
1. **DORA compliance & accountability** — material risk acceptances, vendor classifications, and RoI
   entries must have clear human auditability (Art. 5/28).
2. **Record integrity** — pure AI detection risks hallucinated/unverified entries in the legally-binding RoI.
3. **Operational efficiency** — purely manual workflows create friction and miss untracked dependencies (shadow IT).
4. **Separation of concerns** — this governs *actions*; CI/Gatekeeper/CODEOWNERS govern *deployment*; ADR-0005 governs *data*.

## Decisions

### 1. Interaction paradigm — Copilot-first ("agentic-on-rails")
- **Propose-and-verify:** agents autonomously discover, parse evidence/contracts, reason over risk, and
  **pre-fill** forms/blueprints — but present every consequential action as a **proposal in a HITL review
  queue**, never an applied change.
- **Human-gated state transitions:** a consequential state change — CIF (critical/important-function)
  classification, **reportability determination** (ADR-0005), residual-risk acceptance, contract approval,
  RoI entry/submission, sign-off — requires an **explicit authorized human action** (a capability in the
  ADR-0004 `can()` map; a **SERVICE principal must NOT** perform it — the §1b SoD guard applies).
- **Bounded autonomy:** low-stakes background loops run autonomously but **route anomalies to the human
  queue** — continuous CVE polling, periodic re-assessment triggers, Statuspage/incident scraping,
  discovery sweeps (the existing `surveillance`/`discovery` runs). They **propose**; they never decide.
- **Graduation path:** a specific loop may graduate from copilot → **autonomous-with-approval** only after
  its audit trail + accuracy are demonstrated (an explicit, logged decision per loop), never by default.

### 2. The three-layer decision split — NEVER an LLM alone for compliance
| Layer | Owns | Examples |
|---|---|---|
| **Deterministic regulatory rules** | mandatory conditions / gating | "a qualifying third-party ICT service ⇒ RoI"; Art. 28/30 thresholds; the ADR-0005 reportability gate |
| **AI (LLM + tools)** | contextual reasoning, evidence analysis, discovery, **grounded** proposals | parse a contract → propose a classification + DORA refs + **confidence**; map controls to evidence |
| **Human (authorized reviewer)** | **material/consequential decisions** | approve/modify/reject classification; accept residual risk; sign off the register |

Risk **scores** are a **deterministic engine** (AI assists interpretation; human may override). The LLM
**proposes grounded, cited mappings**; it never *determines* compliance. All LLM calls follow `llmops.md`
(LiteLLM gateway + per-product Langfuse trace tree + managed, label-routed prompts) so every proposal is
traceable to its prompt version, model, inputs, and cost.

Responsibility split (AI does / human owns): discover assets·deps → AI / validate exceptions · detect
vulns → tools+AI / prioritize · map DORA reqs → AI proposes / **human approves** · classify third-party
relationship → AI recommends / **human approves** · evaluate controls → AI analyzes evidence / confirm
effectiveness · risk score → **engine**+AI / override · accept residual risk → AI recommends / **human
decides** · audit report → AI drafts / human signs.

### 3. Register ground truth — hybrid declared + AI discovery
- **Authoritative baseline:** the firm's **declared** contractual arrangements are the primary legal
  ground truth (declare-first).
- **AI completeness overlay:** discovery connectors (AP/SaaS-spend/IdP/vendor attachments) run as a
  **continuous completeness layer** that surfaces unmapped vendors + flags gaps **for human review** —
  the existing RTV-91/92 (propose → human-confirm) + register-completeness pattern, generalized.
- **Rationale:** pure AI-detect-only risks hallucinated RoI entries (integrity); declare-only misses
  shadow IT. Declared ground truth + AI gap-detection = the differentiator.
- Agents must preserve the ADR-0005 **relationship taxonomy** (direct ICT provider vs subcontractor vs
  technical software dependency) and the **three delivery models** (self-managed / externally-managed /
  cloud-SaaS) — proposing the right *workflow* per model, humans confirming.

### 4. Audit & authorization requirements
Every proposed → decided state transition logs (append-only, ADR-0004 `action_audit` pattern):
- **`proposed_by`** — agent id + prompt context/hash + model + Langfuse trace id.
- **`reviewed_by`** — user id + role (authorized via ADR-0004 SoD; service principals excluded).
- **`action_timestamp`** — exact UTC of approval/modification/rejection, with the decision rationale + evidence refs.
The determination history is immutable and survives principal disable. The HITL queue itself is an
auditable object (what was proposed, by which agent/prompt, decided by whom, when, why).

## Scenarios (how a reviewer experiences it)
- **Self-hosted community GLPI** → AI proposes *"internal ICT asset; no qualifying external service found
  → recommend internal ICT-risk assessment; NOT a RoI arrangement (ADR-0005 `not_reportable`), pending
  human confirmation of ownership + contractual facts."* Human approves/modifies.
- **Contract upload describing ongoing GLPI maintenance** → AI detects a **direct ICT provider** + proposes
  *"qualifying third-party ICT service likely → start supplier due-diligence + Art. 30 assessment."* Human
  confirms before anything enters the RoI.
- **SaaS on AWS (vendor→AWS)** → AI proposes a **direct provider** (the SaaS) + a **subcontractor/dependency**
  (AWS), not one vendor bucket; human confirms the chain + CIF support.

## Alternatives considered
- **Fully autonomous agents decide + write** → rejected: violates DORA Art. 5 accountability + record integrity; no human liability anchor.
- **Pure copilot (analyst-triggered only, no background loops)** → rejected: misses continuous surveillance + shadow-IT discovery (operational-efficiency driver).
- **Chosen: copilot-first / agentic-on-rails** with bounded autonomous *surveillance/discovery* loops that only ever **propose** → balances all four drivers.

## Security / regulatory risks
- **Over-trust of AI proposals** → mitigation: human-gated consequential transitions + confidence surfaced + deterministic gating.
- **Hallucinated RoI entries** → mitigation: declared ground truth + human confirm + grounded/cited proposals + Langfuse trace.
- **Prompt-injection via uploaded contracts/evidence** → mitigation: treat ingested docs as untrusted; the agent proposes, never auto-acts; egress-gated research (ADR-0003); output validated against the deterministic rules.
- **SoD erosion** → mitigation: a SERVICE principal (ADR-0004) can never review/approve; the proposer ≠ the approver.

## Unresolved decisions (for review)
1. **Graduation criteria** — the exact accuracy/audit bar for a loop to move copilot → autonomous-with-approval.
2. **Agent framework** — reuse the platform agents (LangGraph/CrewAI, `minicloud-agent`/`-crew-agent`) vs an in-product orchestrator; relation to `llmops.md`.
3. **HITL-queue model** — a new entity vs an extension of the existing proposals/completeness tables (depends on ADR-0005's shape choice).
4. **Confidence semantics** — how a proposal's confidence maps to review priority / auto-vs-manual routing.
5. **Depends on ADR-0005** being decided first (the determination states the agents target).

## Consequences
Retrieva gets an explainable, evidence-backed, **human-accountable** assessment engine — AI does the
expensive discovery/reasoning/drafting; deterministic rules gate mandatory conditions; humans own every
material decision with a full approval trail. It stays a compliance *reasoning* platform, not an
autonomous decision-maker, and not a CMDB. **BC02/BC03** cert evidence (AI governance + compliance-by-design).

Related: ADR-0004, ADR-0005, ADR-0002, ADR-0003, `minicloud-gitops/.claude/rules/llmops.md`,
`software-evaluation.md`, `[[reference_retrieva_ai_native_dora]]`, `[[project_retrieva_is_service_principal]]`,
`[[reference_dora_market_validation]]`.
