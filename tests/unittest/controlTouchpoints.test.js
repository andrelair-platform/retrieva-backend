/**
 * RTV-34/40 — contract → DORA control touchpoints (pure, deterministic pattern pass over the LIVE
 * control library). The intake preview: which controls a contract's clauses touch, before confirm.
 */
import { describe, it, expect } from 'vitest';
import { summarizeControlTouchpoints } from '../../services/intake/controlTouchpoints.js';

describe('RTV-34 summarizeControlTouchpoints', () => {
  it('maps a multi-clause contract to the controls its clauses touch, ranked by clause count', () => {
    const contract = [
      'The Provider shall maintain a business continuity plan and disaster recovery arrangements, subject to annual resilience testing.',
      'The Financial Entity shall have the right to audit the Provider, including unrestricted rights of access and on-site inspection.',
      'The Provider shall permit pooled audits organised jointly by several financial entities.',
    ].join('\n\n');

    const tps = summarizeControlTouchpoints(contract);
    const ids = tps.map((t) => t.controlId);
    expect(ids).toContain('DORA-30.3c-BCP');
    expect(ids).toContain('DORA-30.3e-AUDIT-RIGHTS');
    // audit is hit by two clauses → ranked above the single-clause BCP.
    const audit = tps.find((t) => t.controlId === 'DORA-30.3e-AUDIT-RIGHTS');
    expect(audit.clauseCount).toBe(2);
    expect(tps[0].controlId).toBe('DORA-30.3e-AUDIT-RIGHTS');
  });

  it('each touchpoint carries the control metadata + the pattern(s) that fired + a sample excerpt', () => {
    const tps = summarizeControlTouchpoints(
      'The Provider shall maintain ICT security measures aligned with ISO 27001 and a SOC 2 report, for the security of the services.'
    );
    const sec = tps.find((t) => t.controlId === 'DORA-30.3d-ICT-SECURITY');
    expect(sec).toBeTruthy();
    expect(sec.doraArticleRef).toBeTruthy();
    expect(sec.title).toBeTruthy();
    expect(sec.matchedPatterns.length).toBeGreaterThan(0);
    expect(sec.sample.length).toBeGreaterThan(0);
  });

  it('ignores boilerplate-short fragments and non-matching prose (no false touchpoints)', () => {
    expect(summarizeControlTouchpoints('Governed by the laws of France.')).toEqual([]);
    expect(summarizeControlTouchpoints('')).toEqual([]);
    expect(summarizeControlTouchpoints('short\n\nalso short')).toEqual([]);
  });
});
