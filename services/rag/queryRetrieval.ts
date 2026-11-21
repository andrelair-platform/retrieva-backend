/**
 * Query Retrieval Module
 * Handles multi-query expansion, HyDE, document retrieval, and deduplication
 * @module services/rag/queryRetrieval
 */

 
import { expandQuery, generateHypotheticalDocument } from './retrievalEnhancements.js';
import { deduplicateDocuments } from '../../utils/rag/contextFormatter.js';

/**
 * @typedef {Object} FilterValidationResult
 * @property {boolean} valid - Whether the value passed validation
 * @property {*} [value] - The sanitized value (if valid)
 * @property {string} [error] - Error message (if invalid)
 */

/**
 * @typedef {Object} PageRangeFilter
 * @property {number} min - Minimum page number
 * @property {number} max - Maximum page number
 */

/**
 * @typedef {Object} QdrantFilterCondition
 * @property {string} key - Field name to filter on
 * @property {Object} [match] - Exact match condition
 * @property {number} [match.value] - Value to match
 * @property {Object} [range] - Range condition
 * @property {number} [range.gte] - Greater than or equal
 * @property {number} [range.lte] - Less than or equal
 */

/**
 * @typedef {Object} QdrantFilter
 * @property {QdrantFilterCondition[]} must - All conditions must match
 */

/**
 * @typedef {Object} DateRangeFilter
 * @property {string|Date} from - Start date (ISO string or Date)
 * @property {string|Date} to - End date (ISO string or Date)
 */

/**
 * @typedef {Object} RetrievalFilters
 * @property {string} workspaceId - Workspace ID (REQUIRED for multi-tenant isolation)
 * @property {number} [page] - Exact page number to filter
 * @property {string} [section] - Section name to filter
 * @property {PageRangeFilter} [pageRange] - Page range to filter
 * @property {DateRangeFilter} [dateRange] - Date range filter (lastModified)
 * @property {string} [author] - Author name filter
 * @property {string} [documentType] - Document type filter (page, database, file)
 * @property {string} [classification] - Exact classification filter (public, internal, confidential, restricted)
 * @property {string} [classificationLevel] - Max classification level (includes all at or below this level)
 * @property {string[]} [tags] - Tags to filter by (any match)
 */

/**
 * @typedef {Object} Document
 * @property {string} pageContent - The text content
 * @property {Object} [metadata] - Document metadata
 * @property {number} [metadata.page] - Page number
 * @property {string} [metadata.section] - Section name
 */

/**
 * @typedef {Object} RetrievalMetrics
 * @property {number} queryVariations - Number of query variations used
 * @property {number} totalRetrieved - Total documents retrieved before dedup
 * @property {number} afterDeduplication - Documents after deduplication
 * @property {string} deduplicationRate - Percentage of duplicates removed
 * @property {number} avgDocLength - Average document length in characters
 * @property {number} uniquePages - Number of unique pages retrieved
 * @property {boolean} filtersApplied - Whether filters were applied
 */

/**
 * @typedef {Object} MultiQueryRetrievalResult
 * @property {Document[]} documents - Retrieved and deduplicated documents
 * @property {string[]} allQueries - All query variations used
 * @property {RetrievalMetrics} metrics - Retrieval statistics
 */

/**
 * @typedef {Object} VectorStoreRetriever
 * @property {function(string): Promise<Document[]>} invoke - Retrieve documents
 */

/**
 * @typedef {Object} VectorStore
 * @property {function(string, number, QdrantFilter?): Promise<Document[]>} similaritySearch - Search with optional filter
 */

/**
 * @typedef {Object} Logger
 * @property {function(string, Object?): void} info - Log info message
 * @property {function(string, Object?): void} debug - Log debug message
 * @property {function(string, Object?): void} warn - Log warning message
 * @property {function(string, Object?): void} error - Log error message
 */

/**
 * Filter validation constants
 * SECURITY FIX (GAP 12): Prevent injection and abuse via filter parameters
 */
const FILTER_LIMITS = {
  page: { min: 1, max: 10000 },
  pageRange: { maxSpan: 100 },
  section: { maxLength: 200, pattern: /^[a-zA-Z0-9\s\-_.,()&]+$/ },
  dateRange: { maxSpanDays: 365 * 5 }, // Max 5 years
  author: { maxLength: 100, pattern: /^[a-zA-Z0-9\s\-_.'@]+$/ },
  documentType: { allowed: ['page', 'database', 'file', 'folder'] },
  classification: { allowed: ['public', 'internal', 'confidential', 'restricted'] },
  tags: { maxCount: 10, maxLength: 50 },
};

function validatePageFilter(value: any) {
  const page = parseInt(value, 10);
  if (isNaN(page)) {
    return { valid: false, error: 'Page must be a number' };
  }
  if (page < FILTER_LIMITS.page.min || page > FILTER_LIMITS.page.max) {
    return {
      valid: false,
      error: `Page must be between ${FILTER_LIMITS.page.min} and ${FILTER_LIMITS.page.max}`,
    };
  }
  return { valid: true, value: page };
}

function validateSectionFilter(value: any) {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Section must be a string' };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Section cannot be empty' };
  }
  if (trimmed.length > FILTER_LIMITS.section.maxLength) {
    return {
      valid: false,
      error: `Section must be under ${FILTER_LIMITS.section.maxLength} characters`,
    };
  }
  // SECURITY: Only allow safe characters to prevent injection
  if (!FILTER_LIMITS.section.pattern.test(trimmed)) {
    return { valid: false, error: 'Section contains invalid characters' };
  }
  return { valid: true, value: trimmed };
}

function validatePageRangeFilter(value: any) {
  if (!value || typeof value !== 'object') {
    return { valid: false, error: 'Page range must be an object with min and max' };
  }
  const min = parseInt(value.min, 10);
  const max = parseInt(value.max, 10);
  if (isNaN(min) || isNaN(max)) {
    return { valid: false, error: 'Page range min/max must be numbers' };
  }
  if (min < FILTER_LIMITS.page.min || max > FILTER_LIMITS.page.max) {
    return {
      valid: false,
      error: `Page range must be between ${FILTER_LIMITS.page.min} and ${FILTER_LIMITS.page.max}`,
    };
  }
  if (min > max) {
    return { valid: false, error: 'Page range min cannot be greater than max' };
  }
  if (max - min > FILTER_LIMITS.pageRange.maxSpan) {
    return {
      valid: false,
      error: `Page range cannot span more than ${FILTER_LIMITS.pageRange.maxSpan} pages`,
    };
  }
  return { valid: true, value: { min, max } };
}

function validateDateRangeFilter(value: any) {
  if (!value || typeof value !== 'object') {
    return { valid: false, error: 'Date range must be an object with from and to' };
  }
  const from = new Date(value.from);
  const to = new Date(value.to);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return { valid: false, error: 'Date range from/to must be valid dates' };
  }
  if (from > to) {
    return { valid: false, error: 'Date range from cannot be after to' };
  }
  const daysDiff = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
  if (daysDiff > FILTER_LIMITS.dateRange.maxSpanDays) {
    return {
      valid: false,
      error: `Date range cannot span more than ${FILTER_LIMITS.dateRange.maxSpanDays} days`,
    };
  }
  // Return as Unix timestamps for Qdrant
  return { valid: true, value: { from: from.getTime(), to: to.getTime() } };
}

function validateAuthorFilter(value: any) {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Author must be a string' };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Author cannot be empty' };
  }
  if (trimmed.length > FILTER_LIMITS.author.maxLength) {
    return {
      valid: false,
      error: `Author must be under ${FILTER_LIMITS.author.maxLength} characters`,
    };
  }
  if (!FILTER_LIMITS.author.pattern.test(trimmed)) {
    return { valid: false, error: 'Author contains invalid characters' };
  }
  return { valid: true, value: trimmed };
}

function validateDocumentTypeFilter(value: any) {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Document type must be a string' };
  }
  const trimmed = value.trim().toLowerCase();
  if (!FILTER_LIMITS.documentType.allowed.includes(trimmed)) {
    return {
      valid: false,
      error: `Document type must be one of: ${FILTER_LIMITS.documentType.allowed.join(', ')}`,
    };
  }
  return { valid: true, value: trimmed };
}

function validateClassificationFilter(value: any) {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Classification must be a string' };
  }
  const trimmed = value.trim().toLowerCase();
  if (!FILTER_LIMITS.classification.allowed.includes(trimmed)) {
    return {
      valid: false,
      error: `Classification must be one of: ${FILTER_LIMITS.classification.allowed.join(', ')}`,
    };
  }
  return { valid: true, value: trimmed };
}

function validateClassificationLevelFilter(value: any) {
  // Filter by classification level (includes all classifications at or below the specified level)
  // Order: public < internal < confidential < restricted
  if (typeof value !== 'string') {
    return { valid: false, error: 'Classification level must be a string' };
  }
  const trimmed = value.trim().toLowerCase();
  if (!FILTER_LIMITS.classification.allowed.includes(trimmed)) {
    return {
      valid: false,
      error: `Classification level must be one of: ${FILTER_LIMITS.classification.allowed.join(', ')}`,
    };
  }
  // Return all classifications at or below this level
  const levels = FILTER_LIMITS.classification.allowed;
  const levelIndex = levels.indexOf(trimmed);
  return { valid: true, value: levels.slice(0, levelIndex + 1) };
}

function validateTagsFilter(value: any) {
  if (!Array.isArray(value)) {
    return { valid: false, error: 'Tags must be an array' };
  }
  if (value.length > FILTER_LIMITS.tags.maxCount) {
    return {
      valid: false,
      error: `Cannot filter by more than ${FILTER_LIMITS.tags.maxCount} tags`,
    };
  }
  const validTags = [];
  for (const tag of value) {
    if (typeof tag !== 'string') continue;
    const trimmed = tag.trim();
    if (trimmed.length > 0 && trimmed.length <= FILTER_LIMITS.tags.maxLength) {
      validTags.push(trimmed);
    }
  }
  if (validTags.length === 0) {
    return { valid: false, error: 'At least one valid tag is required' };
  }
  return { valid: true, value: validTags };
}

const FILTER_VALIDATORS: Record<string, (value: any) => any> = {
  page: validatePageFilter,
  section: validateSectionFilter,
  pageRange: validatePageRangeFilter,
  dateRange: validateDateRangeFilter,
  author: validateAuthorFilter,
  documentType: validateDocumentTypeFilter,
  classification: validateClassificationFilter,
  classificationLevel: validateClassificationLevelFilter,
  tags: validateTagsFilter,
};

/**
 * Validate and sanitize a filter value
 * @param {'page'|'section'|'pageRange'} type - Type of filter
 * @param {number|string|PageRangeFilter} value - The value to validate
 * @returns {FilterValidationResult} Validation result with sanitized value or error
 * @private
 */
function validateFilterValue(type: string, value: any) {
  const validator = FILTER_VALIDATORS[type];
  if (!validator) {
    return { valid: false, error: `Unknown filter type: ${type}` };
  }
  return validator(value);
}

/**
 * Build Qdrant filter object from filter parameters
 * SECURITY FIX (GAP 12): Validates all filter parameters before building query
 * MULTI-TENANT FIX: ALWAYS includes workspaceId for tenant isolation
 *
 * @param {RetrievalFilters|null} filters - Filter parameters (optional user filters)
 * @param {string} workspaceId - Workspace ID (REQUIRED for multi-tenant isolation)
 * @returns {QdrantFilter} Qdrant filter object (always includes workspaceId)
 * @throws {Error} If workspaceId is missing or filter validation fails
 */
// Accumulates the built filter + any validation errors; threaded through the
// per-filter appliers so each stays within the param budget.
type FilterBuildCtx = { qdrantFilter: { must: any[]; should?: any[] }; errors: string[] };

/** Apply a single exact-match filter: validate → push {key, match:{value}}. */
function applyMatchFilter(filters: any, name: string, key: string, ctx: FilterBuildCtx) {
  if (filters[name] === undefined) return;
  const result = validateFilterValue(name, filters[name]);
  if (!result.valid) {
    ctx.errors.push(result.error!);
  } else {
    ctx.qdrantFilter.must.push({ key, match: { value: result.value } });
  }
}

/** Apply a range filter (pageRange/dateRange) mapping min/max → gte/lte. */
function applyRangeFilter(
  filters: any,
  name: string,
  mapping: { key: string; loField: string; hiField: string },
  ctx: FilterBuildCtx
) {
  if (filters[name] === undefined) return;
  const result = validateFilterValue(name, filters[name]);
  if (!result.valid) {
    ctx.errors.push(result.error!);
    return;
  }
  ctx.qdrantFilter.must.push({
    key: mapping.key,
    range: {
      gte: (result.value as any)[mapping.loField],
      lte: (result.value as any)[mapping.hiField],
    },
  });
}

/** Apply the classification-level filter (includes all at or below level). */
function applyClassificationLevelFilter(filters: any, ctx: FilterBuildCtx) {
  if (filters.classificationLevel === undefined) return;
  const result = validateFilterValue('classificationLevel', filters.classificationLevel);
  if (!result.valid) {
    ctx.errors.push(result.error!);
    return;
  }
  // Use "should" with minimum_should_match for OR logic
  const classificationConditions = (result.value as string[]).map((level) => ({
    key: 'metadata.classification',
    match: { value: level },
  }));

  // Add as a nested should clause
  if (classificationConditions.length === 1) {
    ctx.qdrantFilter.must.push(classificationConditions[0]);
  } else {
    // For multiple levels, we need to wrap in should
    ctx.qdrantFilter.must.push({
      should: classificationConditions,
    });
  }
}

/** Apply the tags filter (any match → OR via should). */
function applyTagsFilter(filters: any, ctx: FilterBuildCtx) {
  if (filters.tags === undefined) return;
  const result = validateFilterValue('tags', filters.tags);
  if (!result.valid) {
    ctx.errors.push(result.error!);
    return;
  }
  // Use "should" for OR logic - document must match at least one tag
  if (!ctx.qdrantFilter.should) {
    ctx.qdrantFilter.should = [];
  }
  for (const tag of result.value as string[]) {
    ctx.qdrantFilter.should.push({
      key: 'metadata.tags',
      match: { value: tag },
    });
  }
}

export function buildQdrantFilter(filters: any, workspaceId: string) {
  // CRITICAL: workspaceId is REQUIRED for multi-tenant isolation
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new Error('workspaceId is required for vector store queries (multi-tenant isolation)');
  }

  const qdrantFilter: { must: any[]; should?: any[] } = { must: [] };
  const errors: string[] = [];

  // ALWAYS add workspaceId filter for tenant isolation
  // This ensures queries only return documents from the user's workspace
  qdrantFilter.must.push({
    key: 'metadata.workspaceId',
    match: { value: workspaceId },
  });

  // Process optional user-provided filters (order preserved from original impl
  // so the `must` array + any joined validation-error message stay identical).
  if (filters && typeof filters === 'object') {
    const ctx: FilterBuildCtx = { qdrantFilter, errors };
    applyMatchFilter(filters, 'page', 'metadata.page', ctx);
    applyMatchFilter(filters, 'section', 'metadata.section', ctx);
    applyRangeFilter(filters, 'pageRange', { key: 'metadata.page', loField: 'min', hiField: 'max' }, ctx);
    applyRangeFilter(
      filters,
      'dateRange',
      { key: 'metadata.lastModified', loField: 'from', hiField: 'to' },
      ctx
    );
    applyMatchFilter(filters, 'author', 'metadata.author', ctx);
    applyMatchFilter(filters, 'documentType', 'metadata.documentType', ctx);
    applyMatchFilter(filters, 'classification', 'metadata.classification', ctx);
    applyClassificationLevelFilter(filters, ctx);
    applyTagsFilter(filters, ctx);
  }

  // If there are validation errors, throw
  if (errors.length > 0) {
    throw new Error(`Filter validation failed: ${errors.join('; ')}`);
  }

  // Always return filter (workspaceId is always present)
  return qdrantFilter;
}

/**
 * Retrieve additional documents for retry with more context
 * Used when initial retrieval doesn't produce sufficient results
 *
 * @param {string[]} allQueries - Query variations to use
 * @param {VectorStoreRetriever} retriever - Vector store retriever
 * @param {VectorStore} vectorStore - Vector store instance
 * @param {QdrantFilter|null} qdrantFilter - Optional Qdrant filter
 * @param {Document[]} existingDocs - Already retrieved documents
 * @returns {Promise<Document[]>} Combined unique documents (existing + additional)
 */
export async function retrieveAdditionalDocuments(opts: {
  allQueries: string[];
  retriever: any;
  vectorStore: any;
  qdrantFilter: any;
  existingDocs: any[];
}) {
  const { allQueries, retriever, vectorStore, qdrantFilter, existingDocs } = opts;
  const additionalDocs: any[] = [];

  for (const qVariation of allQueries.slice(0, 2)) {
    const moreDocs = qdrantFilter
      ? await vectorStore.similaritySearch(qVariation, 20, qdrantFilter)
      : await retriever.invoke(qVariation);
    additionalDocs.push(...moreDocs);
  }

  // Deduplicate combined docs
  const combinedDocs = [...existingDocs, ...additionalDocs];
  return deduplicateDocuments(combinedDocs);
}
