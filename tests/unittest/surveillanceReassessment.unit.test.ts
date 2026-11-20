/**
 * Surveillance → reassessment (Workflow C #3) — a material surveillance event fans out to the provider's
 * direct arrangements and reopens each (removing the "someone must file the supplier notice" step).
 */
import { describe, it, expect, vi } from 'vitest';
import { reopenArrangementsForSurveillanceEvent } from '../../services/surveillance/surveillanceReassessment.js';

describe('reopenArrangementsForSurveillanceEvent', () => {
  it('reopens every direct arrangement of the event provider with reason surveillance-incident', async () => {
    const repo = {
      listByProvider: vi.fn().mockResolvedValue([
        { id: 'A1', lifecycleStatus: 'active' },
        { id: 'A2', lifecycleStatus: 'under_review' },
      ]),
    };
    const reopen = vi.fn().mockResolvedValue({ triggered: true });
    const res = await reopenArrangementsForSurveillanceEvent(
      {
        organizationId: 'o1',
        event: { id: 'ev1', providerNodeId: 'p1', providerName: 'Datadog', severity: 'high', title: 'Major outage', kind: 'incident', url: 'http://x' },
      },
      { repo, reopen }
    );
    expect(res).toMatchObject({ affected: 2, reopened: 2 });
    expect(repo.listByProvider).toHaveBeenCalledWith('o1', 'p1');
    expect(reopen).toHaveBeenCalledTimes(2);
    expect(reopen.mock.calls[0][0]).toMatchObject({
      reason: 'surveillance-incident',
      event: { action: 'arrangement.surveillance_incident', metadata: { eventId: 'ev1', severity: 'high', provider: 'Datadog' } },
    });
  });

  it('no provider node → no-op', async () => {
    const repo = { listByProvider: vi.fn() };
    const reopen = vi.fn();
    const res = await reopenArrangementsForSurveillanceEvent(
      { organizationId: 'o1', event: { id: 'ev2', providerNodeId: null, severity: 'critical' } },
      { repo, reopen }
    );
    expect(res).toMatchObject({ affected: 0, reopened: 0 });
    expect(repo.listByProvider).not.toHaveBeenCalled();
  });
});
