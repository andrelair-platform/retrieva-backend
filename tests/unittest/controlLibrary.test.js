/**
 * RTV-39 — Control Library data model + CIF-keyed applicability (unit).
 */
import { describe, it, expect } from 'vitest';
import {
  getControls,
  getCurrentLibraryVersion,
  isCIF,
  resolveControlsForArrangement,
} from '../../services/controlLibraryService.js';
import { controlLibrarySchema } from '../../config/controlLibrary/schema.js';
import { LIBRARY_VERSIONS } from '../../config/controlLibrary/index.js';
import { summarize } from '../../scripts/seedControlLibrary.js';

describe('RTV-39 control library — shape + version (AC-1/AC-3)', () => {
  it('v1.0.0 validates against the schema and is the current version', () => {
    expect(getCurrentLibraryVersion()).toBe('1.0.0');
    expect(() => controlLibrarySchema.parse(LIBRARY_VERSIONS['1.0.0'])).not.toThrow();
  });

  it('every control carries the AC-1 fields', () => {
    for (const c of getControls('1.0.0')) {
      expect(c.id).toBeTruthy();
      expect(c.doraArticleRef).toMatch(/Article/);
      expect(c.domain).toBeTruthy();
      expect(c.expectedEvidenceTypes.length).toBeGreaterThan(0);
      expect(c.clauseMatchPatterns.length).toBeGreaterThan(0);
      expect(['baseline', 'cif_mandatory', 'cif_enhanced']).toContain(c.applicability);
    }
  });

  it('control ids are unique + getControls throws on an unknown version', () => {
    const ids = getControls().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => getControls('9.9.9')).toThrow(/Unknown control-library version/);
  });

  it('covers the AC-2 DORA control domains', () => {
    const domains = new Set(getControls().map((c) => c.domain));
    for (const d of [
      'Governance',
      'Security and Resilience',
      'Incident Management',
      'Business Continuity',
      'Audit and Inspection',
      'Data Location',
      'Subcontracting',
      'Termination and Exit',
    ]) {
      expect(domains).toContain(d);
    }
  });
});

describe('RTV-39 CIF-keyed applicability resolution (AC-4)', () => {
  it('isCIF: critical/important criticality or a critical-or-important function', () => {
    expect(isCIF({ criticality: 'critical' })).toBe(true);
    expect(isCIF({ criticality: 'important' })).toBe(true);
    expect(isCIF({ criticalOrImportant: true })).toBe(true);
    expect(isCIF({ criticality: 'standard' })).toBe(false);
    expect(isCIF({})).toBe(false);
  });

  it('a CIF arrangement gets baseline + cif controls; a standard one gets only baseline', () => {
    const cif = resolveControlsForArrangement({ criticality: 'critical' });
    const std = resolveControlsForArrangement({ criticality: 'standard' });

    expect(cif.cif).toBe(true);
    expect(std.cif).toBe(false);
    // standard = baseline only
    expect(std.controls.every((c) => c.applicability === 'baseline')).toBe(true);
    // CIF strictly superset of standard, and includes cif_* controls
    expect(cif.controls.length).toBeGreaterThan(std.controls.length);
    expect(cif.controls.some((c) => c.applicability === 'cif_mandatory')).toBe(true);
    expect(cif.controls.some((c) => c.applicability === 'cif_enhanced')).toBe(true);
    // the exit strategy + audit rights controls only appear for CIF
    const cifIds = cif.controls.map((c) => c.id);
    const stdIds = std.controls.map((c) => c.id);
    expect(cifIds).toContain('DORA-28.8-EXIT-STRATEGY');
    expect(stdIds).not.toContain('DORA-28.8-EXIT-STRATEGY');
  });

  it('mandatory flags: baseline + cif_mandatory are mandatory, cif_enhanced is not', () => {
    const { controls } = resolveControlsForArrangement({ criticality: 'critical' });
    for (const c of controls) {
      const expected = c.applicability === 'baseline' || c.applicability === 'cif_mandatory';
      expect(c.mandatory).toBe(expected);
    }
  });

  it('every resolved control is stamped with the library version (AC-4 reproducibility)', () => {
    const { controls, libraryVersion } = resolveControlsForArrangement({
      criticalOrImportant: true,
    });
    expect(libraryVersion).toBe('1.0.0');
    expect(controls.every((c) => c.libraryVersion === '1.0.0')).toBe(true);
  });
});

describe('RTV-39 seed/verify summary (AC-5)', () => {
  it('summarizes the library by domain, applicability and DORA article', () => {
    const s = summarize('1.0.0');
    expect(s.version).toBe('1.0.0');
    expect(s.total).toBe(getControls('1.0.0').length);
    expect(Object.keys(s.byApplicability).sort()).toContain('cif_mandatory');
    expect(s.articles.some((a) => a.includes('Article 28'))).toBe(true);
    expect(s.articles.some((a) => a.includes('Article 30'))).toBe(true);
  });
});
