// A2A contract — `assess-arrangement` skill (RTV-79), the Node⇄Python seam of the agentic assessment
// capability (SDD §5.1, ADR-AGENT-01/02).
//
// SOURCE OF TRUTH. The deterministic supervisor (retrieva-backend, TS) is the A2A *client*; the CrewAI
// crew (retrieva-assessment-crew, Python) is the A2A *server* exposing this skill. Both sides validate
// against the SAME shape: this Zod module is the canonical definition, and `scripts/genA2aContract.ts`
// emits the language-neutral JSON Schema under `contracts/a2a/schema/` that the Python crew validates
// against (so a mocked boundary is backed by a real contract — testing.md Tier-A).
//
// Transport: A2A Spec v1.0 over HTTP+JSON / JSON-RPC, cluster-internal only (no Ingress), netpol-pinned
// to retrieva-backend + a service-token header (SDD §7).
//
// AUTH: the crew's A2A endpoint is reachable only in-cluster from retrieva-backend; a short-lived
// service token travels in the A2A request header (not modelled in the payload schema).
// IDEMPOTENCY: the supervisor guarantees at most one call per (runId, node); a retried delegation with
// the same (runId, node) MUST return the same result and MUST NOT double-write. `node` is carried in the
// request so the server can dedup.
import { z } from 'zod';

/** Contract version — bump on any breaking change to request/response. Mirrors the Agent Card skill version. */
export const ASSESS_ARRANGEMENT_VERSION = '1.1.0'; // 1.1.0: + request.controls[] (real library) + evidenceRef.text
/** A2A protocol spec this contract targets. */
export const A2A_PROTOCOL_VERSION = '1.0';
export const ASSESS_ARRANGEMENT_SKILL_ID = 'assess-arrangement';

// Verdicts mirror the DB `verdict` enum (db/schema/enums.ts) so findings map 1:1 into the register.
export const VERDICTS = [
  'compliant',
  'partial',
  'non_compliant',
  'insufficient_evidence',
  'not_applicable',
] as const;

const uuid = z.string().uuid();
const confidence = z.number().min(0).max(1);

// ── Request — what the supervisor sends the crew ─────────────────────────────────────────────────
const ClauseSchema = z
  .object({
    ref: z.string().min(1).describe('Stable clause reference, e.g. "§12.3"'),
    text: z.string().min(1).describe('The contract clause text to map to controls'),
  })
  .strict();

const EvidenceRefSchema = z
  .object({
    id: z.string().min(1).describe('Evidence chunk id (Qdrant point / document ref)'),
    collection: z.string().optional().describe('Vector collection the chunk lives in'),
    source: z.string().optional().describe('Human-readable source (filename / title)'),
    text: z.string().optional().describe('The evidence passage text (when available) — grounds citations'),
  })
  .strict();

// The applicable controls the crew assesses against (RTV-81b §2) — the real DORA control library
// (resolveControlsForArrangement), not a prompt-embedded catalog. The crew maps clauses to THESE and
// echoes `ref` as the finding/verdict controlRef, so results map 1:1 into the register (→ persistence).
const ControlSchema = z
  .object({
    ref: z.string().min(1).describe('Stable control id — the crew echoes it as the verdict/finding controlRef'),
    doraArticleRef: z.string().optional().describe('DORA article reference, e.g. "Article 30(3)(e)"'),
    title: z.string().min(1).describe('Short control title'),
    description: z.string().describe('What the control requires'),
  })
  .strict();

export const AssessArrangementRequestSchema = z
  .object({
    runId: uuid.describe('The assessment_runs.id this delegation belongs to'),
    node: z.string().min(1).default('gap').describe('Calling supervisor node — idempotency key with runId'),
    arrangementId: uuid.describe('The ICT arrangement under assessment'),
    controlLibraryVersion: z.string().min(1).describe('Control-library version to assess against (echoed in findings)'),
    controls: z
      .array(ControlSchema)
      .optional()
      .describe('Applicable controls to assess against; absent/empty → the crew falls back to its DORA catalog'),
    clauses: z.array(ClauseSchema).describe('Contract clauses to map to DORA controls'),
    evidenceRefs: z.array(EvidenceRefSchema).describe('Evidence the crew may retrieve/cite; it persists nothing'),
    context: z.record(z.string(), z.unknown()).optional().describe('Opaque passthrough (sessionId, locale, …)'),
  })
  .strict();

// ── Response — what the crew returns (proposed, never authoritative until a human approves) ──────
const FindingSchema = z
  .object({
    controlRef: z.string().min(1),
    clauseRefs: z.array(z.string()).describe('Clause refs that map to this control'),
    summary: z.string().describe('What the crew concluded for this control'),
  })
  .strict();

const VerdictSchema = z
  .object({
    controlRef: z.string().min(1),
    verdict: z.enum(VERDICTS),
    confidence,
  })
  .strict();

const CitationSchema = z
  .object({
    evidenceId: z.string().min(1).describe('An EvidenceRef.id that grounds a finding'),
    controlRef: z.string().optional(),
    snippet: z.string().optional(),
  })
  .strict();

export const AssessArrangementResponseSchema = z
  .object({
    controlLibraryVersion: z.string().min(1).describe('Echo of the library version assessed against'),
    findings: z.array(FindingSchema),
    verdicts: z.array(VerdictSchema),
    citations: z.array(CitationSchema),
    confidence: confidence.describe('Overall calibrated confidence — drives the supervisor halt-on-doubt gate'),
    insufficientEvidence: z.array(z.string()).describe('Control refs with no retrievable evidence (not guessed)'),
  })
  .strict();

export type AssessArrangementRequest = z.infer<typeof AssessArrangementRequestSchema>;
export type AssessArrangementResponse = z.infer<typeof AssessArrangementResponseSchema>;
export type AssessArrangementControl = z.infer<typeof ControlSchema>;

// ── Agent Card — the descriptor the crew serves at /.well-known/agent.json (A2A Spec v1.0). ──────
// Authored here (source of truth); the Python crew serves it via crewai[a2a]/a2a-sdk (RTV-80). The I/O
// schemas are referenced by file so both sides share one definition.
export const ASSESS_ARRANGEMENT_AGENT_CARD = {
  protocolVersion: A2A_PROTOCOL_VERSION,
  name: 'retrieva-assessment-crew',
  description: 'DORA ICT third-party assessment crew — maps contract clauses to controls, finds gaps, scores coverage. Evidence-grounded; output is proposed, not authoritative (human-gated by the supervisor).',
  version: ASSESS_ARRANGEMENT_VERSION,
  capabilities: { streaming: false, pushNotifications: false },
  defaultInputModes: ['application/json'],
  defaultOutputModes: ['application/json'],
  skills: [
    {
      id: ASSESS_ARRANGEMENT_SKILL_ID,
      name: 'Assess ICT arrangement for DORA',
      description: 'Given clauses + evidence refs + a control-library version, return findings, verdicts, citations, an overall confidence, and the controls with insufficient evidence.',
      tags: ['dora', 'ict-tprm', 'assessment', 'gap-analysis'],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
      // Internal convention: the committed JSON Schemas are the wire contract both sides validate against.
      io: {
        requestSchema: 'contracts/a2a/schema/assess-arrangement.request.json',
        responseSchema: 'contracts/a2a/schema/assess-arrangement.response.json',
      },
    },
  ],
} as const;
