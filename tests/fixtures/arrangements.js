/**
 * RTV-36 arrangement-graph fixture — the domain-model ADR §1 canonical example.
 *
 * ONE provider (Microsoft) with a nth-party subcontractor (OpenAI), ONE service (Azure), TWO
 * legal entities (Ktayl France, Ktayl Belgium) with a function each (Claims = critical, Email =
 * not), and TWO arrangements that share the provider but differ in everything DORA cares about:
 *
 *   France / Azure / Claims  → critical, [pii, claims], residency FR, high dependency, hard exit
 *   Belgium / Azure / Email  → standard, [email],        residency BE, low  dependency, easy exit
 *
 * The point the fixture proves: the *arrangement* is the fact, the provider is a dimension.
 *
 * Two entry points:
 *  - `buildArrangementGraph()` — a pure nested object graph (no DB), for unit assertions.
 *  - `seedArrangementGraph(db, { organizationId, createdBy })` — inserts the rows and returns
 *    the created ids, for integration tests. `db` is a Drizzle handle; the provider node is
 *    reused from RTV-48 (`provider_nodes` + `provider_dependencies`).
 */
import {
  legalEntities,
  businessFunctions,
  ictServices,
  arrangements,
  providerNodes,
  providerDependencies,
} from '../../db/schema/index.js';

/** The provider / subcontractor / service / entities / functions / arrangements, as plain data. */
export const FIXTURE = {
  provider: { canonicalName: 'microsoft', displayName: 'Microsoft', providerType: 'cloud' },
  subcontractor: { canonicalName: 'openai', displayName: 'OpenAI', providerType: 'ai_ml' },
  service: { name: 'Azure', serviceType: 'cloud' },
  entities: {
    france: { name: 'Ktayl France', country: 'FR' },
    belgium: { name: 'Ktayl Belgium', country: 'BE' },
  },
  functions: {
    claims: { name: 'Claims Handling', criticalOrImportant: true },
    email: { name: 'Corporate Email', criticalOrImportant: false },
  },
  arrangements: {
    franceClaims: {
      arrangementType: 'external',
      dataClasses: ['pii', 'claims'],
      dataResidency: 'FR',
      criticality: 'critical',
      dependency: 'high',
      exitDifficulty: 'high',
    },
    belgiumEmail: {
      arrangementType: 'external',
      dataClasses: ['email'],
      dataResidency: 'BE',
      criticality: 'standard',
      dependency: 'low',
      exitDifficulty: 'low',
    },
  },
};

/** Pure nested graph (no DB) — one provider, one service, two entities, two arrangements. */
export function buildArrangementGraph() {
  const provider = { ...FIXTURE.provider, subcontractors: [{ ...FIXTURE.subcontractor }] };
  const service = { ...FIXTURE.service, provider };
  return {
    provider,
    service,
    entities: [
      {
        ...FIXTURE.entities.france,
        functions: [{ ...FIXTURE.functions.claims }],
        arrangements: [{ ...FIXTURE.arrangements.franceClaims, provider, service }],
      },
      {
        ...FIXTURE.entities.belgium,
        functions: [{ ...FIXTURE.functions.email }],
        arrangements: [{ ...FIXTURE.arrangements.belgiumEmail, provider, service }],
      },
    ],
  };
}

/**
 * Insert the fixture graph for one org. Returns the created ids so tests can traverse.
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase} db
 * @param {{ organizationId: string, createdBy?: string }} ctx
 */
export async function seedArrangementGraph(db, { organizationId, createdBy = null }) {
  // Provider (reused RTV-48 identity) + its nth-party subcontractor edge (AC-3).
  const [provider] = await db
    .insert(providerNodes)
    .values({
      organizationId,
      kind: 'external',
      canonicalName: FIXTURE.provider.canonicalName,
      displayName: FIXTURE.provider.displayName,
      providerType: FIXTURE.provider.providerType,
    })
    .returning();
  const [subcontractor] = await db
    .insert(providerNodes)
    .values({
      organizationId,
      kind: 'external',
      canonicalName: FIXTURE.subcontractor.canonicalName,
      displayName: FIXTURE.subcontractor.displayName,
      providerType: FIXTURE.subcontractor.providerType,
    })
    .returning();
  const [edge] = await db
    .insert(providerDependencies)
    .values({
      organizationId,
      parentNodeId: provider.id,
      childNodeId: subcontractor.id,
    })
    .returning();

  const [service] = await db
    .insert(ictServices)
    .values({
      organizationId,
      providerId: provider.id,
      name: FIXTURE.service.name,
      serviceType: FIXTURE.service.serviceType,
    })
    .returning();

  const [france] = await db
    .insert(legalEntities)
    .values({ organizationId, ...FIXTURE.entities.france })
    .returning();
  const [belgium] = await db
    .insert(legalEntities)
    .values({ organizationId, ...FIXTURE.entities.belgium })
    .returning();

  const [claims] = await db
    .insert(businessFunctions)
    .values({ organizationId, legalEntityId: france.id, ...FIXTURE.functions.claims })
    .returning();
  const [email] = await db
    .insert(businessFunctions)
    .values({ organizationId, legalEntityId: belgium.id, ...FIXTURE.functions.email })
    .returning();

  const [franceClaims] = await db
    .insert(arrangements)
    .values({
      organizationId,
      legalEntityId: france.id,
      businessFunctionId: claims.id,
      providerId: provider.id,
      ictServiceId: service.id,
      createdBy,
      ...FIXTURE.arrangements.franceClaims,
    })
    .returning();
  const [belgiumEmail] = await db
    .insert(arrangements)
    .values({
      organizationId,
      legalEntityId: belgium.id,
      businessFunctionId: email.id,
      providerId: provider.id,
      ictServiceId: service.id,
      createdBy,
      ...FIXTURE.arrangements.belgiumEmail,
    })
    .returning();

  return {
    provider,
    subcontractor,
    edge,
    service,
    entities: { france, belgium },
    functions: { claims, email },
    arrangements: { franceClaims, belgiumEmail },
  };
}
