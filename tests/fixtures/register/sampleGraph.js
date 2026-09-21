/**
 * RTV-38 register fixture — a deterministic flat arrangement graph for the projection unit test
 * and the golden-file. One group + one entity, two arrangements (one external critical, one
 * intra-group), a Microsoft→OpenAI subcontractor edge, and intentional gaps: providers carry no
 * country (and OpenAI no LEI), no workspace-backed assessment → those required fields become gaps.
 */
export const sampleGraph = {
  legalEntities: [
    {
      id: 'e0',
      name: 'Ktayl Group',
      lei: 'LEI-GRP',
      country: 'FR',
      isGroupEntity: true,
      parentEntityId: null,
    },
    {
      id: 'e1',
      name: 'Ktayl France',
      lei: 'LEI-FR',
      country: 'FR',
      isGroupEntity: false,
      parentEntityId: 'e0',
    },
  ],
  businessFunctions: [
    { id: 'f1', name: 'Claims Handling', criticalOrImportant: true, legalEntityId: 'e1' },
  ],
  ictServices: [{ id: 's1', name: 'Azure' }],
  providerNodes: [
    {
      id: 'p1',
      displayName: 'Microsoft',
      lei: 'LEI-MSFT',
      providerType: 'cloud',
      workspaceId: null,
    },
    { id: 'p2', displayName: 'OpenAI', lei: null, providerType: 'ai_ml', workspaceId: null },
  ],
  arrangements: [
    {
      id: 'a1',
      legalEntityId: 'e1',
      businessFunctionId: 'f1',
      providerId: 'p1',
      ictServiceId: 's1',
      arrangementType: 'external',
      criticality: 'critical',
      dataClasses: ['pii', 'claims'],
      dataResidency: 'FR',
      dependency: 'high',
      exitDifficulty: 'high',
    },
    {
      id: 'a2',
      legalEntityId: 'e1',
      businessFunctionId: 'f1',
      providerId: 'p2',
      ictServiceId: null,
      arrangementType: 'intra_group',
      criticality: 'important',
      dataClasses: ['pii'],
      dataResidency: 'BE',
      dependency: 'medium',
      exitDifficulty: 'low',
    },
  ],
  edges: [
    {
      parent: { name: 'Microsoft' },
      child: { name: 'OpenAI' },
      relationship: 'sub_processes_via',
      confirmed: true,
    },
  ],
  assessmentByWorkspace: {},
};
