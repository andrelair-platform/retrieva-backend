/**
 * P4 — audit-readiness service orchestration. Unit-tests that the service delegates to the pure builders
 * with INJECTED loaders (no DB). The fetch (default loaders) is verified live at the QA gate.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildDashboard, buildArrangementAuditPack } from '../../services/reportability/auditReadinessService.js';
import type { DashboardArrangement } from '../../services/reportability/auditDashboard.js';

describe('P4 buildDashboard', () => {
  it('passes the loaded arrangements + config through to the pure dashboard builder', async () => {
    const arrangements: DashboardArrangement[] = [
      { id: 'a', label: 'A', criticality: 'standard', lifecycleStatus: 'active', lastAssessedAt: null, contractValidUntil: null, hasOpenRegisterGap: false },
    ];
    const loadArrangements = vi.fn(async () => arrangements);
    const res = await buildDashboard('org1', { now: new Date('2026-06-01T00:00:00Z') }, { loadArrangements });
    expect(loadArrangements).toHaveBeenCalledWith('org1');
    expect(res.totals).toEqual({ arrangements: 1, active: 1 });
    expect(res.overdueReassessments.total).toBe(1); // never-assessed active → overdue
  });
});

describe('P4 buildArrangementAuditPack', () => {
  it('assembles the loaded artefacts into a pack with the supplied meta', async () => {
    const loadArtefacts = vi.fn(async () => ({
      scope: { type: 'arrangement' as const, id: 'arr1' },
      arrangement: { id: 'arr1' },
      findings: [{ id: 'f1' }],
      risks: [],
    }));
    const meta = { generatedAt: '2026-06-01T00:00:00Z', generatedBy: 'auditor-1' };
    const pack = await buildArrangementAuditPack('org1', 'arr1', meta, { loadArtefacts });
    expect(loadArtefacts).toHaveBeenCalledWith('org1', 'arr1');
    expect(pack.manifest.scope).toEqual({ type: 'arrangement', id: 'arr1' });
    expect(pack.manifest.generatedBy).toBe('auditor-1');
    expect(pack.manifest.totalRecords).toBe(2); // arrangement + 1 finding
    expect(pack.manifest.integrityHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('propagates a loader 404 (arrangement not in org)', async () => {
    const loadArtefacts = vi.fn(async () => {
      throw Object.assign(new Error('Arrangement not found'), { statusCode: 404 });
    });
    await expect(buildArrangementAuditPack('org1', 'missing', { generatedAt: 'x', generatedBy: 'y' }, { loadArtefacts })).rejects.toMatchObject({ statusCode: 404 });
  });
});
