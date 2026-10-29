/**
 * AUD-P1 Tier B — the evaluations (procurement) scope gate. The ADR-0002 vendor-evaluation flow is
 * sourcing/procurement, out of scope for DORA Art 28–30; DISABLED by default (404), reversibly re-enabled
 * with EVALUATIONS_PROCUREMENT_ENABLED=true. Read at request time so routes stay mounted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendError = vi.fn((res: any, code: number, message: string) => {
  res.statusCode = code;
  res.body = { message };
  return res;
});
vi.mock('../../utils/index.js', () => ({ sendError: (...a: unknown[]) => (sendError as any)(...a) }));

import { evaluationsProcurementGate, evaluationsProcurementEnabled } from '../../middleware/evaluationsGate.js';

const res = () => ({ statusCode: 0, body: null }) as any;
const ORIG = process.env.EVALUATIONS_PROCUREMENT_ENABLED;
beforeEach(() => {
  sendError.mockClear();
  delete process.env.EVALUATIONS_PROCUREMENT_ENABLED;
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.EVALUATIONS_PROCUREMENT_ENABLED;
  else process.env.EVALUATIONS_PROCUREMENT_ENABLED = ORIG;
});

describe('evaluationsProcurementGate (AUD-P1 Tier B)', () => {
  it('default (unset) ⇒ disabled → 404, next NOT called', () => {
    const next = vi.fn();
    const r = res();
    evaluationsProcurementGate({} as any, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(404);
    expect(String(r.body?.message)).toMatch(/out of scope/i);
  });

  it('EVALUATIONS_PROCUREMENT_ENABLED=true ⇒ next(), no error (reversible)', () => {
    process.env.EVALUATIONS_PROCUREMENT_ENABLED = 'true';
    const next = vi.fn();
    evaluationsProcurementGate({} as any, res(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(sendError).not.toHaveBeenCalled();
  });

  it('garbage/false ⇒ disabled; case-insensitive true', () => {
    process.env.EVALUATIONS_PROCUREMENT_ENABLED = 'false';
    expect(evaluationsProcurementEnabled()).toBe(false);
    process.env.EVALUATIONS_PROCUREMENT_ENABLED = 'TRUE';
    expect(evaluationsProcurementEnabled()).toBe(true);
  });
});
