/**
 * Context formatting utilities for RAG
 * Formats documents and sources for LLM context
 * @module utils/contextFormatter
 */

/**
 * @typedef {Object} DocumentMetadata
 * @property {string} [documentTitle] - Title of the source document
 * @property {string} [section] - Section within the document
 * @property {string} [documentUrl] - URL of the document
 * @property {string} [source] - Alternative source path/URL
 * @property {string} [documentType] - Type of document (page, database, etc.)
 * @property {string} [block_type] - Type of content block
 * @property {string[]} [heading_path] - Breadcrumb path of headings
 * @property {number} [positionPercent] - Position in document (0-100)
 * @property {number} [score] - Relevance score
 * @property {number} [rrfScore] - RRF fusion score
 */

/**
 * @typedef {Object} Document
 * @property {string} pageContent - The text content of the document
 * @property {DocumentMetadata} [metadata] - Document metadata
 */

/**
 * @typedef {Object} ChunkInfo
 * @property {string|null} blockType - Type of content block
 * @property {string[]} headingPath - Breadcrumb path of headings
 * @property {number|null} position - Position in document
 */

/**
 * @typedef {Object} FormattedSource
 * @property {string} id - Unique source identifier (for frontend compatibility)
 * @property {number} sourceNumber - 1-based source reference number
 * @property {string} title - Document title
 * @property {string} content - Preview of chunk content (for frontend display)
 * @property {string} url - Document URL
 * @property {boolean} official - False for unofficial working translations (#424)
 * @property {string|null} pageId - Source page/document ID
 * @property {number|null} score - Relevance score as number (for frontend compatibility)
 * @property {string|null} section - Section within document
 * @property {string} type - Document type
 * @property {string|null} relevanceScore - Relevance score (4 decimal places) - legacy
 * @property {ChunkInfo} chunkInfo - Chunk metadata
 */

/**
 * Format documents into context string with source citations
 * Creates numbered source headers for LLM context
 *
 * @param {Document[]} docs - Documents to format
 * @returns {string} Formatted context string with [Source N] headers
 */
interface DocLike {
  pageContent?: string;
   
  metadata?: Record<string, any>;
  rrfScore?: number;
  score?: number;
}

export function formatContext(docs: DocLike[]) {
  return docs
    .map((doc, index) => {
      const docTitle = doc.metadata?.documentTitle || 'Untitled';
      const headingPath = doc.metadata?.heading_path;
      const sourceNum = index + 1;

      // Use full heading breadcrumb for hierarchical disambiguation.
      // Falls back to legacy section field for backward compatibility.
      const sectionLabel =
        headingPath?.length > 0 ? headingPath.join(' > ') : doc.metadata?.section || '';

      const header =
        sectionLabel && sectionLabel !== 'General'
          ? `[Source ${sourceNum}: ${docTitle} - ${sectionLabel}]`
          : `[Source ${sourceNum}: ${docTitle}]`;

      return `${header}\n${doc.pageContent}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Format documents into source metadata array
 * Extracts and structures metadata for response
 *
 * @param {Document[]} docs - Documents to format
 * @returns {FormattedSource[]} Array of formatted source metadata
 */
// Truncate content to a ~200-char preview, snapping back to the last word boundary (ellipsis appended).
function buildContentPreview(fullContent: string): string {
  let contentPreview = fullContent.substring(0, 200);
  if (fullContent.length > 200) {
    const lastSpace = contentPreview.lastIndexOf(' ');
    if (lastSpace > 150) {
      contentPreview = contentPreview.substring(0, lastSpace);
    }
    contentPreview += '...';
  }
  return contentPreview;
}

// The `metadata.url` precedence note (EUR-Lex link, #424): url before source (a category tag, not a URL).
function sourceUrl(meta: any): string {
  return meta?.documentUrl || meta?.url || meta?.source || '';
}

function chunkInfoOf(meta: any) {
  return {
    blockType: meta?.block_type || null,
    headingPath: meta?.heading_path || [],
    position: meta?.positionPercent || null,
  };
}

// The frontend-compatible identity fields (title/id/pageId/url/official) — isolates their fallbacks.
function sourceIdentity(meta: any, sourceNumber: number) {
  return {
    id: meta?.sourceId || `source-${sourceNumber}`,
    title: meta?.documentTitle || 'Untitled',
    url: sourceUrl(meta),
    // false for the working French translation → the UI labels it unofficial.
    official: meta?.official !== false,
    pageId: meta?.sourceId || null,
  };
}

// The relevance score in both numeric + legacy-string shapes (null when absent).
function sourceScores(doc: DocLike): { score: number | null; relevanceScore: string | null } {
  const relevanceScore = doc.rrfScore || doc.score || null;
  return {
    score: relevanceScore ? parseFloat(relevanceScore.toFixed(4)) : null,
    relevanceScore: relevanceScore?.toFixed(4) || null, // Legacy string format
  };
}

// Build one formatted source object from a document + its 1-based source number.
function formatSource(doc: DocLike, sourceNumber: number) {
  const meta = doc.metadata;
  const { score, relevanceScore } = sourceScores(doc);

  // Use original content for display (before compression) if available — shows the actual document
  // content, not LLM-compressed text.
  const fullContent = meta?._originalContent || doc.pageContent || '';

  return {
    // Frontend-compatible fields
    ...sourceIdentity(meta, sourceNumber),
    content: buildContentPreview(fullContent),
    score,

    // Extended metadata
    sourceNumber,
    section: meta?.section || null,
    type: meta?.documentType || 'page',
    relevanceScore, // Legacy string format
    chunkInfo: chunkInfoOf(meta),
  };
}

export function formatSources(docs: DocLike[]) {
  return docs.map((doc, index) => formatSource(doc, index + 1));
}

/**
 * Deduplicate documents by content
 * Uses first 100 characters as fingerprint for comparison
 *
 * @param {Document[]} docs - Documents to deduplicate
 * @returns {Document[]} Unique documents (first occurrence preserved)
 */
export function deduplicateDocuments(docs: DocLike[]) {
  const uniqueDocs = [];
  const seenContent = new Set();

  for (const doc of docs) {
    const contentKey = doc.metadata?.contentFingerprint || (doc.pageContent || '').substring(0, 100);
    if (!seenContent.has(contentKey)) {
      seenContent.add(contentKey);
      uniqueDocs.push(doc);
    }
  }

  return uniqueDocs;
}
