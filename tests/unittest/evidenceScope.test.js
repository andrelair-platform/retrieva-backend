/**
 * RTV-37 — evidence model + audit-log append-only surface (unit).
 */
import { describe, it, expect } from 'vitest';
import { evidenceInsertSchema, auditLogInsertSchema } from '../../db/schema/zod.js';
import { AuditLogRepository } from '../../repositories/drizzle/AuditLogRepository.js';
import { sha256 } from '../../utils/security/crypto.js';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('RTV-37 evidence — Zod DTO validation', () => {
  it('accepts a provider-scoped evidence row', () => {
    const r = evidenceInsertSchema.safeParse({
      organizationId: UUID,
      scope: 'provider',
      providerId: UUID,
      document: 'ISO 27001 certificate',
      hash: sha256('bytes'),
    });
    expect(r.success).toBe(true);
  });

  it('accepts an arrangement-scoped evidence row', () => {
    const r = evidenceInsertSchema.safeParse({
      organizationId: UUID,
      scope: 'arrangement',
      arrangementId: UUID,
      document: 'Signed contract',
      hash: sha256('bytes'),
    });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid scope', () => {
    const r = evidenceInsertSchema.safeParse({
      organizationId: UUID,
      scope: 'global',
      document: 'x',
      hash: 'h',
    });
    expect(r.success).toBe(false);
  });

  it('requires document + hash', () => {
    expect(
      evidenceInsertSchema.safeParse({ organizationId: UUID, scope: 'provider', providerId: UUID })
        .success
    ).toBe(false);
  });
});

describe('RTV-37 audit log — append-only surface (AC-4)', () => {
  const repo = new AuditLogRepository();

  it('the repository refuses update/delete in code', async () => {
    await expect(repo.updateById('id', {})).rejects.toThrow(/append-only/);
    await expect(repo.updateWhere({}, {})).rejects.toThrow(/append-only/);
    await expect(repo.deleteById('id')).rejects.toThrow(/append-only/);
    await expect(repo.deleteWhere({})).rejects.toThrow(/append-only/);
  });

  it('the insert schema requires action + target_type', () => {
    expect(auditLogInsertSchema.safeParse({ organizationId: UUID }).success).toBe(false);
    expect(
      auditLogInsertSchema.safeParse({
        organizationId: UUID,
        action: 'finding.approve',
        targetType: 'arrangement',
      }).success
    ).toBe(true);
  });
});
