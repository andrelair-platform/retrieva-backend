/**
 * RTV-22 — type-level assertions on the DORA graph row types (`$inferSelect`/`$inferInsert`).
 * These are compile-time guards: if a column is dropped/renamed/retyped on a table, the row type
 * shifts and `expectTypeOf` fails to compile — the graph's shape can't silently drift. (Runtime
 * body is a trivial pass; the assertions are checked under `vitest --typecheck` / tsc.)
 */
import { describe, it, expectTypeOf } from 'vitest';
import type {
  ArrangementRow,
  ArrangementInsert,
  FindingRow,
  ProviderDependencyRow,
} from '../../db/schema/index.js';

// The RTV-31 lifecycle enum, asserted inline (arrangementLifecycle is still JS until RTV-24).
type LifecycleStatus =
  | 'prospect'
  | 'due_diligence'
  | 'active'
  | 'under_review'
  | 'remediation'
  | 'exiting'
  | 'exited';

describe('DORA graph row types (RTV-22)', () => {
  it('an arrangement row carries the identifying + lifecycle fields', () => {
    expectTypeOf<ArrangementRow>().toHaveProperty('id').toEqualTypeOf<string>();
    expectTypeOf<ArrangementRow>().toHaveProperty('organizationId').toEqualTypeOf<string>();
    // lifecycleStatus is the RTV-31 enum, not a bare string
    expectTypeOf<ArrangementRow['lifecycleStatus']>().toEqualTypeOf<LifecycleStatus>();
  });

  it('the insert shape makes DB-defaulted columns optional', () => {
    // id is defaultRandom() → optional on insert
    expectTypeOf<ArrangementInsert>().toHaveProperty('id').toEqualTypeOf<string | undefined>();
    // organizationId is NOT NULL with no default → required on insert
    expectTypeOf<ArrangementInsert>().toHaveProperty('organizationId').toEqualTypeOf<string>();
  });

  it('a finding row exposes the §5 verdict + status fields', () => {
    expectTypeOf<FindingRow>().toHaveProperty('verdict');
    expectTypeOf<FindingRow>().toHaveProperty('status');
    expectTypeOf<FindingRow>().toHaveProperty('arrangementId').toEqualTypeOf<string>();
  });

  it('a provider dependency (nth-party edge) is typed, not any', () => {
    expectTypeOf<ProviderDependencyRow>().toHaveProperty('parentNodeId').toEqualTypeOf<string>();
    expectTypeOf<ProviderDependencyRow>().toHaveProperty('childNodeId').toEqualTypeOf<string>();
  });
});
