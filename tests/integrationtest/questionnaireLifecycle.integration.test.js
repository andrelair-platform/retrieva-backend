/**
 * retrieva-backend#13 — QuestionnaireService lifecycle on real Postgres, proving the
 * Mongoose→Drizzle migration of the write paths (create → send → getPublicForm →
 * submitResponse), which previously used `.save()` / `.deleteOne()` / `._id`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, workspaces, questionnaireTemplates } from '../../db/schema/index.js';
import { QuestionnaireService } from '../../services/QuestionnaireService.js';
import { QuestionnaireTemplateRepository } from '../../repositories/drizzle/QuestionnaireTemplateRepository.js';
import { VendorQuestionnaireRepository } from '../../repositories/drizzle/VendorQuestionnaireRepository.js';

let db;
let svc;
let queue;
let email;
let userId;
let wsId;

describe('QuestionnaireService lifecycle (retrieva-backend#13)', () => {
  beforeAll(async () => {
    await startPg();
    await connectPg();
    await runMigrations();
    db = getDb();
  });
  afterAll(async () => {
    await disconnectPg();
    await stopPg();
  });
  beforeEach(async () => {
    await db.execute(
      sql`truncate table vendor_questionnaires, questionnaire_templates, workspaces, users restart identity cascade`
    );
    const [u] = await db
      .insert(users)
      .values({ email: `u-${Math.random().toString(36).slice(2)}@x.io`, password: 'h', name: 'n' })
      .returning();
    userId = u.id;
    const [w] = await db.insert(workspaces).values({ name: 'W', userId }).returning();
    wsId = w.id;
    await db.insert(questionnaireTemplates).values({
      name: 'Default',
      isDefault: true,
      questions: [{ id: 'q1', text: 'Q?', doraArticle: '28', category: 'ICT', hint: '' }],
    });

    queue = { add: vi.fn().mockResolvedValue({}) };
    email = { sendQuestionnaireInvitation: vi.fn().mockResolvedValue({}) };
    svc = new QuestionnaireService({
      templateRepo: new QuestionnaireTemplateRepository({ db }),
      questionnaireRepo: new VendorQuestionnaireRepository({ db }),
      questionnaireQueue: queue,
      emailService: email,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
  });

  it('create → send → getPublicForm → submitResponse(final) transitions the row', async () => {
    // create
    const created = await svc.createQuestionnaire({
      vendorName: 'Acme',
      vendorEmail: 'V@Acme.com',
      workspaceId: wsId,
      userId,
    });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe('draft');
    expect(created.questions).toHaveLength(1);

    // send (updateByIdUnscoped — was `.save()`)
    const sent = await svc.sendQuestionnaire(created.id, { userName: 'Owner' }, [
      { _id: wsId, name: 'W' },
    ]);
    expect(sent.status).toBe('sent');
    expect(sent.token).toBeTruthy();
    expect(email.sendQuestionnaireInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: 'v@acme.com', questionnaireId: String(created.id) })
    );

    // public form for the vendor
    const form = await svc.getPublicForm(sent.token);
    expect(form.state).toBe('ok');
    expect(form.questionnaire.id).toBe(created.id);

    // vendor submits (final) — updateByIdUnscoped persists answers + status, enqueues scoring
    const result = await svc.submitResponse(sent.token, {
      answers: [{ id: 'q1', answer: 'Yes' }],
      final: true,
    });
    expect(result).toEqual({ state: 'saved', final: true });
    expect(queue.add).toHaveBeenCalledWith(
      'scoreQuestionnaire',
      { questionnaireId: String(created.id) },
      expect.objectContaining({ jobId: `scoreQuestionnaire-${created.id}` })
    );

    // the persisted row reflects the merged answer + status
    const repo = new VendorQuestionnaireRepository({ db });
    const row = await repo.findByIdUnscoped(created.id);
    expect(row.status).toBe('partial');
    expect(row.respondedAt).toBeTruthy();
    expect(row.questions.find((q) => q.id === 'q1').answer).toBe('Yes');
  });

  it('deleteQuestionnaire removes the row (was Mongoose .deleteOne)', async () => {
    const created = await svc.createQuestionnaire({
      vendorName: 'Acme',
      vendorEmail: 'v@acme.com',
      workspaceId: wsId,
      userId,
    });
    await svc.deleteQuestionnaire(created.id, userId, [wsId]);
    const repo = new VendorQuestionnaireRepository({ db });
    expect(await repo.findByIdUnscoped(created.id)).toBeNull();
  });
});
