/**
 * Drizzle CriticalFunctionRepository (RTV-49 pt5). Org-scoped DORA critical/important
 * functions. The Mongoose `dependsOn: [Workspace]` array is now the M2M join table
 * `critical_function_dependencies` — this repo presents a `dependsOn: [workspaceId]`
 * array to callers (concentrationService) while persisting the join rows.
 */
import { and, eq, asc, inArray } from 'drizzle-orm';
import { BaseDrizzleRepository } from './BaseDrizzleRepository.js';
import { criticalFunctions, criticalFunctionDependencies } from '../../db/schema/index.js';
import { entityScopeCondition } from '../../services/security/entityScope.js';

type CfRow = { id: string; [k: string]: unknown };

export class CriticalFunctionRepository extends BaseDrizzleRepository {
  constructor(opts: { db?: unknown } = {}) {
    super(criticalFunctions, opts);
  }

  /** Attach dependsOn (workspace id array) to a plain cf row. */
  async _withDependsOn(rows: CfRow | CfRow[]) {
    const list = Array.isArray(rows) ? rows : [rows];
    if (list.length === 0) return list;
    const ids = list.map((c) => c.id);
    const deps = await this.db
      .select()
      .from(criticalFunctionDependencies)
      .where(inArray(criticalFunctionDependencies.criticalFunctionId, ids));
    const byCf = new Map<string, string[]>();
    for (const d of deps as Array<{ criticalFunctionId: string; workspaceId: string }>) {
      if (!byCf.has(d.criticalFunctionId)) byCf.set(d.criticalFunctionId, []);
      byCf.get(d.criticalFunctionId)!.push(String(d.workspaceId));
    }
    return list.map((c) => ({ ...c, dependsOn: byCf.get(c.id) || [] }));
  }

  async listByOrg(organizationId: string) {
    const rows = await this.find(
      and(
        eq(criticalFunctions.organizationId, organizationId),
        entityScopeCondition(criticalFunctions.organizationId, { action: 'criticalFunction:read' })
      ),
      { orderBy: [asc(criticalFunctions.criticality), asc(criticalFunctions.name)] }
    );
    return this._withDependsOn(rows);
  }

  async _setDependsOn(criticalFunctionId: string, dependsOn?: string[]) {
    await this.db
      .delete(criticalFunctionDependencies)
      .where(eq(criticalFunctionDependencies.criticalFunctionId, criticalFunctionId));
    const ids = [...new Set((dependsOn || []).map(String))];
    if (ids.length) {
      await this.db
        .insert(criticalFunctionDependencies)
        .values(ids.map((workspaceId) => ({ criticalFunctionId, workspaceId })));
    }
  }

  /** Create or update (by id within the org) a critical function + its dependsOn set. */
  async upsert(
    organizationId: string,
    {
      id,
      name,
      criticality,
      description,
      dependsOn,
      userId,
    }: {
      id?: string;
      name?: string;
      criticality?: string;
      description?: string;
      dependsOn?: string[];
      userId?: string;
    }
  ) {
    let row;
    if (id) {
      [row] = await this.db
        .update(criticalFunctions)
        .set({ name, criticality, description: description || '' })
        .where(
          and(
            eq(criticalFunctions.id, id),
            eq(criticalFunctions.organizationId, organizationId),
            entityScopeCondition(criticalFunctions.organizationId, {
              action: 'criticalFunction:edit',
            })
          )
        )
        .returning();
      if (!row) return null;
    } else {
      row = await this.create({
        organizationId,
        name,
        criticality,
        description: description || '',
        createdBy: userId || null,
      });
    }
    await this._setDependsOn(row.id, dependsOn);
    const [withDeps] = await this._withDependsOn(row);
    return withDeps;
  }

  async deleteByIdAndOrg(organizationId: string, id: string) {
    const [row] = await this.db
      .delete(criticalFunctions)
      .where(
        and(
          eq(criticalFunctions.id, id),
          eq(criticalFunctions.organizationId, organizationId),
          entityScopeCondition(criticalFunctions.organizationId, {
            action: 'criticalFunction:delete',
          })
        )
      )
      .returning();
    return row ?? null;
  }
}

export const criticalFunctionRepository = new CriticalFunctionRepository();
