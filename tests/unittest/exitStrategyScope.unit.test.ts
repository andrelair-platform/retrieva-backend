/**
 * AUD-P1-02 — exit-strategy scope isolation. The alternative-provider matching + reintegration estimate
 * are scope-adjacent (sourcing / capacity planning) and DISABLED by default; the exit blueprint (DORA Art
 * 28(8) core) is never gated. Proves the gate short-circuits BEFORE touching the arrangement repo, and
 * that it is reversible via EXIT_ENRICHMENTS_ENABLED.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const loadArrangementContext = vi.fn();
vi.mock('../../repositories/index.js', () => ({
  exitArtefactRepository: {
    loadArrangementContext: (...a: unknown[]) => loadArrangementContext(...a),
    upsertDraft: vi.fn(),
    listByOrg: vi.fn(),
    getById: vi.fn(),
    setDecision: vi.fn(),
  },
  substituteProviderRepository: { listByType: vi.fn(async () => []) },
}));
vi.mock('../../services/exitStrategy/providerMatching.js', () => ({ matchAlternativeProviders: vi.fn() }));
vi.mock('../../services/exitStrategy/exitBlueprint.js', () => ({ generateExitBlueprint: vi.fn() }));
vi.mock('../../services/exitStrategy/reintegration.js', () => ({ modelReintegration: vi.fn() }));

import {
  draftProviderMatches,
  draftReintegration,
  draftExitBlueprint,
} from '../../modules/exit-strategy/exit-strategy.controller.js';

const req = () => ({ user: { organizationId: 'o', userId: 'u' }, params: { arrangementId: 'a' } }) as any;
const res = () => {
  const r: any = { statusCode: 0, body: null };
  r.status = (c: number) => ((r.statusCode = c), r);
  r.json = (b: unknown) => ((r.body = b), r);
  return r;
};
const ORIG = process.env.EXIT_ENRICHMENTS_ENABLED;

beforeEach(() => {
  loadArrangementContext.mockReset();
  delete process.env.EXIT_ENRICHMENTS_ENABLED;
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.EXIT_ENRICHMENTS_ENABLED;
  else process.env.EXIT_ENRICHMENTS_ENABLED = ORIG;
});

describe('exit-strategy scope isolation (AUD-P1-02)', () => {
  it('OFF (default) ⇒ provider-matches is 404 and the arrangement repo is NEVER touched', async () => {
    const r = res();
    await draftProviderMatches(req(), r, vi.fn());
    expect(r.statusCode).toBe(404);
    expect(String(r.body?.message)).toMatch(/out of scope/i);
    expect(loadArrangementContext).not.toHaveBeenCalled(); // gate short-circuits before any work
  });

  it('OFF (default) ⇒ reintegration is 404, repo never touched', async () => {
    const r = res();
    await draftReintegration(req(), r, vi.fn());
    expect(r.statusCode).toBe(404);
    expect(loadArrangementContext).not.toHaveBeenCalled();
  });

  it('OFF ⇒ the exit BLUEPRINT (Art 28(8) core) is NEVER gated — it reaches the handler', async () => {
    loadArrangementContext.mockResolvedValue(null); // handler then 404s "Arrangement not found"
    const r = res();
    await draftExitBlueprint(req(), r, vi.fn());
    expect(loadArrangementContext).toHaveBeenCalledOnce(); // proves it passed through (not gated)
    expect(r.statusCode).toBe(404);
    expect(String(r.body?.message)).toMatch(/arrangement not found/i);
  });

  it('ON ⇒ provider-matches passes the gate into the handler (reversible)', async () => {
    process.env.EXIT_ENRICHMENTS_ENABLED = 'true';
    loadArrangementContext.mockResolvedValue(null); // handler then 404s "Arrangement not found"
    const r = res();
    await draftProviderMatches(req(), r, vi.fn());
    expect(loadArrangementContext).toHaveBeenCalledOnce(); // gate let it through
    expect(String(r.body?.message)).toMatch(/arrangement not found/i);
  });
});
