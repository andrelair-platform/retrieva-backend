/**
 * retrieva-backend#11 — the Drizzle replacements for the Mongo aggregation/find leftovers:
 *  - AssessmentRepository/VendorQuestionnaireRepository `latestCompleteByWorkspaces`
 *    (Postgres DISTINCT ON, replaces `$match → $sort → $group($first)`);
 *  - VendorQuestionnaireRepository `listByWorkspaces` (paginated, filtered, heavy JSONB omitted).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, workspaces, assessments, vendorQuestionnaires } from '../../db/schema/index.js';
import { AssessmentRepository } from '../../repositories/drizzle/AssessmentRepository.js';
import { VendorQuestionnaireRepository } from '../../repositories/drizzle/VendorQuestionnaireRepository.js';

let db;
let aRepo;
let qRepo;
let userId;
let wsA;
let wsB;

const mkA = (workspaceId, status, createdAt, results) =>
  db
    .insert(assessments)
    .values({ workspaceId, name: 'a', vendorName: 'v', status, createdAt, results })
    .returning()
    .then((r) => r[0]);

const mkQ = (workspaceId, status, createdAt, overallScore) =>
  db
    .insert(vendorQuestionnaires)
    .values({
      workspaceId,
      vendorName: 'v',
      vendorEmail: 'v@x.io',
      status,
      createdAt,
      overallScore,
    })
    .returning()
    .then((r) => r[0]);

describe('ROI + Questionnaire repos (retrieva-backend#11)', () => {
  beforeAll(async () => {
    await startPg();
    await connectPg();
    await runMigrations();
    db = getDb();
    aRepo = new AssessmentRepository({ db });
    qRepo = new VendorQuestionnaireRepository({ db });
  });
  afterAll(async () => {
    await disconnectPg();
    await stopPg();
  });
  beforeEach(async () => {
    await db.execute(
      sql`truncate table vendor_questionnaires, assessments, workspaces, users restart identity cascade`
    );
    const [u] = await db
      .insert(users)
      .values({ email: `u-${Math.random().toString(36).slice(2)}@x.io`, password: 'h', name: 'n' })
      .returning();
    userId = u.id;
    [wsA] = await db.insert(workspaces).values({ name: 'A', userId }).returning();
    [wsB] = await db.insert(workspaces).values({ name: 'B', userId }).returning();
  });

  it('assessment latestCompleteByWorkspaces: newest COMPLETE row per workspace', async () => {
    await mkA(wsA.id, 'complete', new Date('2026-01-01'), { overallRisk: 'Low' });
    const latestA = await mkA(wsA.id, 'complete', new Date('2026-06-01'), { overallRisk: 'High' });
    await mkA(wsA.id, 'pending', new Date('2026-07-01'), null); // excluded (not complete)
    await mkA(wsB.id, 'complete', new Date('2026-03-01'), { overallRisk: 'Medium' });

    const rows = await aRepo.latestCompleteByWorkspaces([wsA.id, wsB.id]);
    expect(rows).toHaveLength(2);
    const byWs = Object.fromEntries(rows.map((r) => [r.workspaceId, r]));
    expect(byWs[wsA.id].id).toBe(latestA.id); // the newest complete, not the pending
    expect(byWs[wsA.id].results.overallRisk).toBe('High');
    expect(byWs[wsB.id].results.overallRisk).toBe('Medium');
    expect(await aRepo.latestCompleteByWorkspaces([])).toEqual([]);
  });

  it('questionnaire latestCompleteByWorkspaces + listByWorkspaces (filter/paginate/no heavy cols)', async () => {
    await mkQ(wsA.id, 'complete', new Date('2026-01-01'), 60);
    const latestQA = await mkQ(wsA.id, 'complete', new Date('2026-06-01'), 90);
    await mkQ(wsA.id, 'draft', new Date('2026-07-01'), null);
    await mkQ(wsB.id, 'complete', new Date('2026-02-01'), 75);

    const latest = await qRepo.latestCompleteByWorkspaces([wsA.id, wsB.id]);
    expect(latest).toHaveLength(2);
    const byWs = Object.fromEntries(latest.map((r) => [r.workspaceId, r]));
    expect(byWs[wsA.id].id).toBe(latestQA.id);
    expect(byWs[wsA.id].overallScore).toBe(90);

    // list: newest-first, heavy JSONB omitted, correct total
    const all = await qRepo.listByWorkspaces({
      workspaceIds: [wsA.id, wsB.id],
      page: 1,
      limit: 10,
    });
    expect(all.total).toBe(4);
    expect(all.rows[0]).not.toHaveProperty('questions');
    expect(all.rows[0]).not.toHaveProperty('results');
    expect(all.rows[0].vendorName).toBe('v');

    // status filter
    const completeOnly = await qRepo.listByWorkspaces({
      workspaceIds: [wsA.id, wsB.id],
      status: 'complete',
      page: 1,
      limit: 10,
    });
    expect(completeOnly.total).toBe(3);

    // single-workspace filter
    const wsAonly = await qRepo.listByWorkspaces({
      workspaceIds: [wsA.id, wsB.id],
      workspaceId: wsA.id,
      page: 1,
      limit: 10,
    });
    expect(wsAonly.total).toBe(3);

    // pagination
    const page2 = await qRepo.listByWorkspaces({
      workspaceIds: [wsA.id, wsB.id],
      page: 2,
      limit: 2,
    });
    expect(page2.rows).toHaveLength(2);
    expect(page2.page).toBe(2);
  });
});
