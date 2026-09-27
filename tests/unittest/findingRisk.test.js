/**
 * RTV-43 — finding→risk derivation (pure). Only an APPROVED gap verdict routes into the remediation
 * loop; compliant/not_applicable never opens a risk. Severity is derived here, not model-reported.
 */
import { describe, it, expect } from 'vitest';
import {
  verdictWarrantsRisk,
  severityForVerdict,
  buildRiskFromFinding,
} from '../../services/assessment/findingRisk.js';

describe('RTV-43 verdictWarrantsRisk — only gap verdicts become risks', () => {
  it('gap verdicts warrant a risk', () => {
    expect(verdictWarrantsRisk('non_compliant')).toBe(true);
    expect(verdictWarrantsRisk('partial')).toBe(true);
    expect(verdictWarrantsRisk('insufficient_evidence')).toBe(true);
  });

  it('a clean or N/A verdict does NOT open a risk (approving it closes the loop)', () => {
    expect(verdictWarrantsRisk('compliant')).toBe(false);
    expect(verdictWarrantsRisk('not_applicable')).toBe(false);
    expect(verdictWarrantsRisk(null)).toBe(false);
    expect(verdictWarrantsRisk(undefined)).toBe(false);
  });
});

describe('RTV-43 severityForVerdict — evidence-grounded, not model self-report', () => {
  it('maps gap verdicts to severities', () => {
    expect(severityForVerdict('non_compliant')).toBe('high');
    expect(severityForVerdict('partial')).toBe('medium');
    expect(severityForVerdict('insufficient_evidence')).toBe('low');
  });

  it('defaults to low for an unexpected value (never throws)', () => {
    expect(severityForVerdict('compliant')).toBe('low');
    expect(severityForVerdict(undefined)).toBe('low');
  });
});

describe('RTV-43 buildRiskFromFinding — the human-readable risk fields', () => {
  it('derives a titled, severity-tagged risk from an approved gap-finding', () => {
    const r = buildRiskFromFinding({
      controlId: 'DORA-30.3d-ICT-SECURITY',
      verdict: 'non_compliant',
      rationale: 'No ISO 27001 or SOC 2 evidence for CIF services.',
    });
    expect(r).toEqual({
      title: 'Non-compliant: DORA-30.3d-ICT-SECURITY',
      description: 'No ISO 27001 or SOC 2 evidence for CIF services.',
      severity: 'high',
      sourceVerdict: 'non_compliant',
    });
  });

  it('an insufficient-evidence gap becomes a low-severity risk (obtain evidence)', () => {
    const r = buildRiskFromFinding({
      controlId: 'DORA-28.8-EXIT-STRATEGY',
      verdict: 'insufficient_evidence',
    });
    expect(r.severity).toBe('low');
    expect(r.sourceVerdict).toBe('insufficient_evidence');
    expect(r.title).toContain('Insufficient evidence');
  });
});
