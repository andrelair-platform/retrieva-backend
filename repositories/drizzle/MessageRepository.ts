/**
 * Drizzle MessageRepository (RTV-49 pt3). Messages are keyed by conversationId (NOT a
 * workspace tenant table — they're isolated transitively via their conversation), so
 * plain base. `content` is encrypted at rest (app-layer): create() encrypts, reads
 * decrypt. Additive; not wired yet.
 */
import { and, eq, gte, lte, asc, desc, sql } from 'drizzle-orm';
import { BaseDrizzleRepository, type Row } from './BaseDrizzleRepository.js';
import { messages } from '../../db/schema/index.js';
import { safeEncrypt, safeDecrypt } from '../../utils/security/fieldEncryption.js';
import { escapeRegExp } from '../../utils/core/escapeRegExp.js';

type MessageRow = Record<string, unknown>;

export class MessageRepository extends BaseDrizzleRepository {
  constructor(opts: { db?: unknown } = {}) {
    super(messages, opts);
  }

  _decrypt(row: MessageRow | null | undefined) {
    if (!row) return row;
    return { ...row, content: safeDecrypt(row.content as string) };
  }

  async create(values: Row) {
    const row = await super.create({ ...values, content: safeEncrypt(values.content as string) });
    return this._decrypt(row);
  }

  async createMany(values: Row[]) {
    const rows = await super.createMany(
      (values || []).map((v) => ({ ...v, content: safeEncrypt(v.content as string) }))
    );
    return (rows as MessageRow[]).map((r) => this._decrypt(r));
  }

  async findByConversation(conversationId: string, { limit }: { limit?: number } = {}) {
    const rows = await this.find(eq(messages.conversationId, conversationId), {
      orderBy: asc(messages.timestamp),
      limit,
    });
    return (rows as MessageRow[]).map((r) => this._decrypt(r));
  }

  /** Last N messages, returned oldest→newest (for chat history). */
  async getRecentMessages(conversationId: string, limit = 20) {
    const rows = await this.find(eq(messages.conversationId, conversationId), {
      orderBy: desc(messages.timestamp),
      limit,
    });
    return (rows as MessageRow[]).reverse().map((r) => this._decrypt(r));
  }

  async getChatHistory(conversationId: string, limit = 20) {
    const rows = await this.getRecentMessages(conversationId, limit);
    return (rows as MessageRow[]).map((m) => ({ role: m.role, content: m.content }));
  }

  async addUserMessage(conversationId: string, content: string) {
    return this.create({ conversationId, role: 'user', content });
  }

  async addAssistantMessage(conversationId: string, content: string) {
    return this.create({ conversationId, role: 'assistant', content });
  }

  async addMessagePair(conversationId: string, userMessage: string, assistantMessage: string) {
    // Stagger the timestamps so the user turn deterministically precedes the assistant
    // turn: both rows in a single INSERT would otherwise share the same now() and tie
    // on ordering (Mongo relied on implicit insertion order; SQL needs an explicit key).
    const now = Date.now();
    return this.createMany([
      { conversationId, role: 'user', content: userMessage, timestamp: new Date(now) },
      { conversationId, role: 'assistant', content: assistantMessage, timestamp: new Date(now + 1) },
    ]);
  }

  async deleteByConversation(conversationId: string) {
    return this.deleteWhere(eq(messages.conversationId, conversationId));
  }

  async countByConversation(conversationId: string) {
    return this.count(eq(messages.conversationId, conversationId));
  }

  /** { user: n, assistant: n } — replaces the Mongo $group aggregation. */
  async countByRole(conversationId: string) {
    const rows = await this.db
      .select({ role: messages.role, count: sql<number>`count(*)::int` })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .groupBy(messages.role);
    const counts: Record<string, number> = { user: 0, assistant: 0 };
    for (const r of rows as Array<{ role: string; count: number }>) counts[r.role] = r.count;
    return counts;
  }

  async searchInConversation(conversationId: string, searchTerm: string) {
    // content is encrypted at rest → can't ILIKE in SQL; filter in app after decrypt.
    // (Bounded by conversation size; escape kept for parity/safety.)
    const term = escapeRegExp(String(searchTerm).slice(0, 200)).toLowerCase();
    const rows = await this.findByConversation(conversationId);
    return (rows as MessageRow[]).filter((m) =>
      String(m.content || '').toLowerCase().includes(term)
    );
  }

  async findInTimeRange(conversationId: string, startTime: Date, endTime: Date) {
    const conds = [eq(messages.conversationId, conversationId)];
    if (startTime) conds.push(gte(messages.timestamp, startTime));
    if (endTime) conds.push(lte(messages.timestamp, endTime));
    const rows = await this.find(and(...conds), { orderBy: asc(messages.timestamp) });
    return (rows as MessageRow[]).map((r) => this._decrypt(r));
  }

  async getLastMessage(conversationId: string) {
    const [row] = await this.find(eq(messages.conversationId, conversationId), {
      orderBy: desc(messages.timestamp),
      limit: 1,
    });
    return row ? this._decrypt(row) : null;
  }

  async getFirstMessage(conversationId: string) {
    const [row] = await this.find(eq(messages.conversationId, conversationId), {
      orderBy: asc(messages.timestamp),
      limit: 1,
    });
    return row ? this._decrypt(row) : null;
  }
}

export const messageRepository = new MessageRepository();
