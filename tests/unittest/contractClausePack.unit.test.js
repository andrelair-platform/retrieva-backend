/**
 * contractClausePack (ADR-0002, E3) — the DORA Art. 30 mandatory-clause pack + draft gap-check.
 * Runs against the REAL versioned control library (v1.0.0 carries the Art. 30(2)/(3) controls), so
 * these tests also guard that the library keeps its contractual provisions. Pure, no DB/LLM.
 */
import { describe, it, expect } from 'vitest';

const { buildClausePack, gapCheckClausePack } =
  await import('../../services/legal/contractClausePack.js');

describe('buildClausePack (criticality-tiered Art. 30)', () => {
  it('a non-CIF arrangement gets only the Art. 30(2) baseline clauses', () => {
    const pack = buildClausePack({ criticality: 'standard' });
    expect(pack.cif).toBe(false);
    expect(pack.clauses.length).toBeGreaterThan(0);
    // every clause is an Article 30 provision, and none are CIF-tier for a non-CIF arrangement
    expect(pack.clauses.every((c) => /article\s*30/i.test(c.articleRef))).toBe(true);
    expect(pack.clauses.every((c) => c.tier === 'baseline')).toBe(true);
    // the 30(2) baseline essentials are present
    const refs = pack.clauses.map((c) => c.articleRef);
    expect(refs).toContain('Article 30(2)(b)'); // data location
    expect(refs).toContain('Article 30(2)(h)'); // termination rights
  });

  it('a CIF arrangement additionally pulls the Art. 30(3) enhanced clauses (audit, BCP, security)', () => {
    const base = buildClausePack({ criticality: 'standard' });
    const cif = buildClausePack({ criticalOrImportant: true });
    expect(cif.cif).toBe(true);
    expect(cif.clauses.length).toBeGreaterThan(base.clauses.length);
    const cifRefs = cif.clauses.map((c) => c.articleRef);
    expect(cifRefs.some((r) => /30\(3\)/.test(r))).toBe(true); // 30(3) extras appear
    expect(cif.clauses.some((c) => c.tier === 'cif')).toBe(true);
    // audit rights (30(3)(e)) is a CIF clause absent from the non-CIF pack
    expect(cifRefs).toContain('Article 30(3)(e)');
    expect(base.clauses.map((c) => c.articleRef)).not.toContain('Article 30(3)(e)');
  });

  it('every clause carries a stable controlId, requirement text, and gap-check signals', () => {
    const pack = buildClausePack({ criticalOrImportant: true });
    for (const c of pack.clauses) {
      expect(c.controlId).toMatch(/^DORA-30/);
      expect(c.requirement.length).toBeGreaterThan(0);
      expect(Array.isArray(c.signals) && c.signals.length).toBeTruthy();
    }
  });
});

describe('gapCheckClausePack (draft contract → covered / weak / missing)', () => {
  it('flags every required clause missing when the draft is empty of them', () => {
    const report = gapCheckClausePack(
      { criticality: 'standard' },
      'This agreement is between the parties. Governing law is Irish law.'
    );
    expect(report.summary.required).toBe(report.items.length);
    expect(report.summary.missing).toBeGreaterThan(0);
    expect(report.summary.covered).toBe(0);
    expect(report.items.every((i) => i.coverage === 'missing' || i.coverage === 'weak')).toBe(true);
  });

  it('marks a clause covered when the draft hits its signals, and totals add up', () => {
    // a draft that speaks to data location + termination/exit (baseline 30(2) provisions)
    const draft = `
      3. Data Location. The Provider shall store and process all Customer Data exclusively within
      data centres located in the European Union, and shall notify the Customer of any change to the
      processing locations or sub-processors used to deliver the services.

      9. Termination. The Customer may terminate this Agreement for the Provider's material breach,
      for supervisory or regulatory reasons, or where ICT risk impairs the service; on termination the
      Provider shall provide transition assistance and return or delete Customer Data.
    `;
    const report = gapCheckClausePack({ criticality: 'standard' }, draft);
    expect(report.summary.required).toBe(
      report.summary.covered + report.summary.weak + report.summary.missing
    );
    // at least one baseline clause should register as covered (or at minimum touched/weak)
    const dataLoc = report.items.find((i) => i.articleRef === 'Article 30(2)(b)');
    expect(dataLoc).toBeTruthy();
    expect(['covered', 'weak']).toContain(dataLoc.coverage);
    expect(dataLoc.clauseCount).toBeGreaterThan(0);
  });

  it('a CIF gap-check requires MORE clauses than a non-CIF one (same draft)', () => {
    const draft = 'Data is stored in the EU. Either party may terminate for breach.';
    const nonCif = gapCheckClausePack({ criticality: 'standard' }, draft);
    const cif = gapCheckClausePack({ criticalOrImportant: true }, draft);
    expect(cif.summary.required).toBeGreaterThan(nonCif.summary.required);
  });
});
