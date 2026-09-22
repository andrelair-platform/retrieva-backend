/**
 * RTV-41 — the §5-guardrail core (pure, no DB/LLM). The insufficient-evidence guardrail is the
 * whole point: absence of evidence must NEVER become auto non-compliant.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  assessControl,
  coverageConfidence,
  markFindingStaleness,
  VERDICTS,
} from '../../services/assessment/verdict.js';

const control = {
  id: 'DORA-30.3d-ICT-SECURITY',
  title: 'ICT security measures',
  doraArticleRef: 'Article 30(3)(d)',
  domain: 'Security and Resilience',
  description: 'ICT security measures for CIF services.',
  expectedEvidenceTypes: ['iso_27001_certificate', 'soc2_report'],
};

describe('RTV-41 assessControl — §5 guardrails', () => {
  it('AC-3: absence of evidence → insufficient_evidence, NEVER auto non_compliant (deterministic)', async () => {
    const judge = vi.fn(); // must not be called
    const r = await assessControl(
      control,
      { spans: [], evidenceRecords: [], searched: [{ scope: 'evidence', documentsExamined: [] }] },
      judge
    );
    expect(r.verdict).toBe('insufficient_evidence');
    expect(r.verdict).not.toBe('non_compliant');
    expect(r.citations).toEqual([]);
    expect(r.searched).toHaveLength(1); // what-was-searched is recorded
    expect(r.confidence).toBe(0);
    expect(judge).not.toHaveBeenCalled(); // no model call on the absence path
  });

  it('evidence present + judge=compliant → citations from spans + coverage confidence', async () => {
    const spans = [
      { source: 'ISO 27001 certificate', snippet: 'ISO 27001 certificate v2024 [provider-global]' },
      { source: 'SOC 2 report', snippet: 'SOC 2 Type II report [provider-global]' },
    ];
    const judge = vi.fn().mockResolvedValue({
      verdict: 'compliant',
      rationale: 'Both certs present [0][1]',
      citedIndices: [0, 1],
    });
    const r = await assessControl(
      control,
      {
        spans,
        evidenceRecords: [{}, {}],
        coveredEvidenceTypes: ['iso_27001_certificate', 'soc2_report'],
        searched: [],
      },
      judge
    );
    expect(r.verdict).toBe('compliant');
    expect(r.citations).toHaveLength(2); // AC-4 cites the evidence
    expect(r.confidence).toBe(1); // 2 of 2 expected types covered
  });

  it('evidence present but judge unparseable/invalid → insufficient_evidence (never fabricate)', async () => {
    const spans = [{ source: 'partial doc', snippet: 'some text' }];
    const judge = vi.fn().mockResolvedValue({ verdict: 'garbage' });
    const r = await assessControl(control, { spans, evidenceRecords: [{}] }, judge);
    expect(r.verdict).toBe('insufficient_evidence');
    expect(r.citations).toEqual(spans); // still cites what was found
  });

  it('a judge throwing does not crash the engine → insufficient_evidence', async () => {
    const spans = [{ source: 'doc', snippet: 'text' }];
    const judge = vi.fn().mockRejectedValue(new Error('LLM down'));
    const r = await assessControl(control, { spans, evidenceRecords: [{}] }, judge);
    expect(r.verdict).toBe('insufficient_evidence');
  });

  it('partial coverage yields a fractional confidence', async () => {
    expect(coverageConfidence(control, ['iso_27001_certificate'])).toBe(0.5);
    expect(coverageConfidence(control, [])).toBe(0);
    expect(coverageConfidence(control, ['iso_27001_certificate', 'soc2_report'])).toBe(1);
  });

  it('every returned verdict is in the enum', async () => {
    const judge = vi.fn().mockResolvedValue({ verdict: 'partial', citedIndices: [] });
    const r = await assessControl(
      control,
      { spans: [{ source: 's', snippet: 't' }], evidenceRecords: [{}] },
      judge
    );
    expect(VERDICTS).toContain(r.verdict);
  });
});

describe('RTV-32 markFindingStaleness — the change signal', () => {
  const t0 = '2026-01-01T00:00:00.000Z';
  const t1 = '2026-02-01T00:00:00.000Z';

  it('flags a finding stale when evidence changed after it was last assessed', () => {
    const { findings, staleCount } = markFindingStaleness(
      [{ id: 'a', updatedAt: t0 }],
      [{ updatedAt: t1 }]
    );
    expect(findings[0].stale).toBe(true);
    expect(staleCount).toBe(1);
  });

  it('is not stale when the finding was assessed after the latest evidence (re-assessed)', () => {
    const { findings, staleCount } = markFindingStaleness(
      [{ id: 'a', updatedAt: t1 }],
      [{ updatedAt: t0 }]
    );
    expect(findings[0].stale).toBe(false);
    expect(staleCount).toBe(0);
  });

  it('no evidence → nothing stale', () => {
    const { staleCount } = markFindingStaleness([{ id: 'a', updatedAt: t1 }], []);
    expect(staleCount).toBe(0);
  });
});
