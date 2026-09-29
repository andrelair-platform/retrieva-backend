/**
 * RTV-227 / #227 — the evidence-request token resolver. Same security contract as the RTV-56
 * questionnaire resolver: an opaque token becomes a single-arrangement principal or a TYPED
 * rejection, and every "is this token still good?" decision (revoked / expired / already fulfilled)
 * lives here. Repos are mocked — this is the pure resolution logic, no DB.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const findByToken = vi.fn();
const findByIdUnscoped = vi.fn();
vi.mock('../../repositories/index.js', () => ({
  evidenceRequestRepository: { findByToken: (...a) => findByToken(...a) },
  arrangementRepository: { findByIdUnscoped: (...a) => findByIdUnscoped(...a) },
}));

const { resolveEvidenceRequestPrincipal } =
  await import('../../services/security/evidenceRequestPrincipal.js');

const FUTURE = new Date(Date.now() + 60 * 60 * 1000);
const PAST = new Date(Date.now() - 60 * 60 * 1000);
const okRequest = {
  id: 'req-1',
  arrangementId: 'arr-1',
  vendorEmail: 'v@acme.io',
  requestedCategories: ['soc2_report', 'iso27001_cert'],
  revokedAt: null,
  status: 'pending',
  tokenExpiresAt: FUTURE,
};

beforeEach(() => {
  findByToken.mockReset();
  findByIdUnscoped.mockReset();
  findByIdUnscoped.mockResolvedValue({ organizationId: 'org-1' });
});

describe('resolveEvidenceRequestPrincipal', () => {
  it('resolves a valid pending token to a single-arrangement evidence:upload principal', async () => {
    findByToken.mockResolvedValue(okRequest);
    const r = await resolveEvidenceRequestPrincipal('tok');
    expect(r.ok).toBe(true);
    expect(r.principal).toMatchObject({
      kind: 'vendor_contact',
      evidenceRequestId: 'req-1',
      arrangementId: 'arr-1',
      organizationId: 'org-1',
      vendorEmail: 'v@acme.io',
      requestedCategories: ['soc2_report', 'iso27001_cert'],
      capabilities: ['evidence:upload'],
    });
    expect(r.principal.capabilities).not.toContain('questionnaire:respond');
  });

  it('rejects an unknown token (not_found)', async () => {
    findByToken.mockResolvedValue(null);
    expect(await resolveEvidenceRequestPrincipal('nope')).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('rejects a revoked request regardless of expiry', async () => {
    findByToken.mockResolvedValue({ ...okRequest, revokedAt: new Date() });
    expect(await resolveEvidenceRequestPrincipal('tok')).toEqual({ ok: false, reason: 'revoked' });
  });

  it('rejects an already-fulfilled request (complete)', async () => {
    findByToken.mockResolvedValue({ ...okRequest, status: 'fulfilled' });
    expect(await resolveEvidenceRequestPrincipal('tok')).toEqual({ ok: false, reason: 'complete' });
  });

  it('rejects an expired token', async () => {
    findByToken.mockResolvedValue({ ...okRequest, tokenExpiresAt: PAST });
    expect(await resolveEvidenceRequestPrincipal('tok')).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects when the bound arrangement has no org (no_org)', async () => {
    findByToken.mockResolvedValue(okRequest);
    findByIdUnscoped.mockResolvedValue(null);
    expect(await resolveEvidenceRequestPrincipal('tok')).toEqual({ ok: false, reason: 'no_org' });
  });
});
