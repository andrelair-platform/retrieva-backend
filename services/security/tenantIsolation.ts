/**
 * Tenant Isolation Security Layer
 * Defense-in-depth: Enforces workspaceId filtering at the vector store level
 *
 * Even if higher-level code bypasses buildQdrantFilter(), this layer
 * ensures that NO Qdrant search can execute without workspace isolation.
 *
 * @module services/security/tenantIsolation
 */

import logger from '../../config/logger.js';

interface FilterMatch {
  value?: unknown;
}
interface FilterCondition {
  key?: string;
  match?: FilterMatch;
}
interface QdrantFilter {
  must?: FilterCondition[];
  key?: string;
  match?: FilterMatch;
}
// A LangChain vector store — an external SDK object this module monkeypatches; typed `any`
// (its generics don't survive the method wrapping) until RTV-24 revisits the RAG layer.
 
type VectorStore = any;

/**
 * Error thrown when a search is attempted without workspace isolation
 */
export class TenantIsolationError extends Error {
  statusCode: number;
  isSecurityError: boolean;
  constructor(message: string) {
    super(message);
    this.name = 'TenantIsolationError';
    this.statusCode = 403;
    this.isSecurityError = true;
  }
}

// A workspaceId condition is valid iff it keys on metadata.workspaceId with a non-empty string
// match value. Returns the workspaceId string on a match, else null (one predicate → both the
// `must`-array and the top-level simple-match checks share it, keeping the caller flat).
function workspaceIdFromCondition(
  key: string | undefined,
  match: FilterMatch | undefined
): string | null {
  if (key === 'metadata.workspaceId' && match?.value && typeof match.value === 'string') {
    return match.value;
  }
  return null;
}

/** Validate that a Qdrant filter includes workspaceId. */
export function validateWorkspaceFilter(
  filter: QdrantFilter | null | undefined
): { valid: boolean; workspaceId: string | null } {
  if (!filter) {
    return { valid: false, workspaceId: null };
  }

  // Check 'must' array for workspaceId filter
  const mustConditions = filter.must || [];
  for (const condition of mustConditions) {
    const workspaceId = workspaceIdFromCondition(condition.key, condition.match);
    if (workspaceId) {
      return { valid: true, workspaceId };
    }
  }

  // Check if filter itself is a simple match (less common)
  const topLevel = workspaceIdFromCondition(filter.key, filter.match);
  if (topLevel) {
    return { valid: true, workspaceId: topLevel };
  }

  return { valid: false, workspaceId: null };
}

/**
 * Enforce workspace isolation before any search.
 * @param {string} methodName - Name of the search method
 * @param {Object} filter - The filter being used
 */
function enforceIsolation(methodName: string, filter: QdrantFilter | null | undefined) {
  const validation = validateWorkspaceFilter(filter);

  if (!validation.valid) {
    const errorMsg = `SECURITY: ${methodName} rejected - missing workspaceId filter (tenant isolation violation)`;
    logger.error(errorMsg, {
      service: 'tenant-isolation',
      method: methodName,
      filterProvided: !!filter,
      filterKeys: filter ? Object.keys(filter) : [],
    });
    throw new TenantIsolationError(
      'Search rejected: workspace isolation required. All queries must include metadata.workspaceId filter.'
    );
  }

  logger.debug(`Tenant isolation validated for ${methodName}`, {
    service: 'tenant-isolation',
    workspaceId: validation.workspaceId,
  });

  return validation.workspaceId;
}

// Intercept the three direct search methods (similaritySearch + the two optional ones) so each
// enforces isolation before delegating to the original.
function wrapSearchMethods(vectorStore: VectorStore) {
  const originalSimilaritySearch = vectorStore.similaritySearch.bind(vectorStore);
  const originalSimilaritySearchWithScore = vectorStore.similaritySearchWithScore?.bind(vectorStore);
  const originalMaxMarginalRelevanceSearch = vectorStore.maxMarginalRelevanceSearch?.bind(vectorStore);

  vectorStore.similaritySearch = async function (query: string, k: number, filter?: QdrantFilter) {
    enforceIsolation('similaritySearch', filter);
    return originalSimilaritySearch(query, k, filter);
  };

  if (originalSimilaritySearchWithScore) {
    vectorStore.similaritySearchWithScore = async function (
      query: string,
      k: number,
      filter?: QdrantFilter
    ) {
      enforceIsolation('similaritySearchWithScore', filter);
      return originalSimilaritySearchWithScore(query, k, filter);
    };
  }

  if (originalMaxMarginalRelevanceSearch) {
    vectorStore.maxMarginalRelevanceSearch = async function (
      query: string,
      options?: { filter?: QdrantFilter }
    ) {
      enforceIsolation('maxMarginalRelevanceSearch', options?.filter);
      return originalMaxMarginalRelevanceSearch(query, options);
    };
  }
}

// Wrap a retriever's invoke + _getRelevantDocuments so a filter-less call is rejected and a
// filtered one re-enforces isolation. `options` carries the filter the retriever was created with.
function wrapRetrieverMethods(retriever: any, options: { filter?: QdrantFilter }) {
  const noFilter = () => {
    throw new TenantIsolationError(
      'Retriever invoked without workspace filter. Use vectorStore.similaritySearch with explicit filter instead.'
    );
  };

  const originalInvoke = retriever.invoke?.bind(retriever);
  if (originalInvoke) {
    retriever.invoke = async function (query: string) {
      if (!options.filter) noFilter();
      enforceIsolation('retriever.invoke', options.filter);
      return originalInvoke(query);
    };
  }

  const originalGetRelevantDocs = retriever._getRelevantDocuments?.bind(retriever);
  if (originalGetRelevantDocs) {
    retriever._getRelevantDocuments = async function (query: string, runManager?: unknown) {
      if (!options.filter) noFilter();
      enforceIsolation('retriever._getRelevantDocuments', options.filter);
      return originalGetRelevantDocs(query, runManager);
    };
  }
}

// Intercept asRetriever so every retriever it hands out is itself isolation-wrapped.
function wrapAsRetriever(vectorStore: VectorStore) {
  const originalAsRetriever = vectorStore.asRetriever.bind(vectorStore);
  vectorStore.asRetriever = function (options: { filter?: QdrantFilter } = {}) {
    // If no filter is provided, the retriever CANNOT be used safely
    // Log a warning - actual enforcement happens at search time
    if (!options.filter) {
      logger.warn('Creating retriever without filter - searches will fail tenant isolation check', {
        service: 'tenant-isolation',
      });
    }
    const retriever = originalAsRetriever(options);
    wrapRetrieverMethods(retriever, options);
    return retriever;
  };
}

/**
 * Wrap a vector store with tenant isolation enforcement
 * All search methods will be intercepted and validated
 *
 * @param {Object} vectorStore - LangChain vector store instance
 * @returns {Object} Wrapped vector store with enforced isolation
 */
export function wrapWithTenantIsolation(vectorStore: VectorStore): VectorStore {
  if (!vectorStore) {
    throw new Error('Vector store is required for tenant isolation wrapper');
  }

  // Mark as wrapped to prevent double-wrapping
  if (vectorStore._tenantIsolationEnabled) {
    return vectorStore;
  }

  wrapSearchMethods(vectorStore);
  wrapAsRetriever(vectorStore);

  // Mark as wrapped
  vectorStore._tenantIsolationEnabled = true;
  vectorStore._tenantIsolationVersion = '1.0.0';

  logger.info('Vector store wrapped with tenant isolation enforcement', {
    service: 'tenant-isolation',
  });

  return vectorStore;
}

/**
 * Check if a vector store has tenant isolation enabled
 * @param {Object} vectorStore - Vector store to check
 * @returns {boolean} True if isolation is enabled
 */
export function hasTenantIsolation(vectorStore: VectorStore): boolean {
  return vectorStore?._tenantIsolationEnabled === true;
}

/**
 * Create a workspace-scoped filter that can be used with isolated vector stores
 * @param {string} workspaceId - The workspace ID to scope to
 * @param {Object} additionalFilters - Optional additional filter conditions
 * @returns {Object} Qdrant filter object
 */
export function createWorkspaceScopedFilter(
  workspaceId: string,
  additionalFilters: QdrantFilter = {}
): QdrantFilter {
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new TenantIsolationError('workspaceId is required to create workspace-scoped filter');
  }

  const filter: { must: FilterCondition[] } = {
    must: [
      {
        key: 'metadata.workspaceId',
        match: { value: workspaceId },
      },
    ],
  };

  // Merge additional filters
  if (additionalFilters.must && Array.isArray(additionalFilters.must)) {
    filter.must.push(...additionalFilters.must);
  }

  return filter;
}
