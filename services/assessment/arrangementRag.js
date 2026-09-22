/**
 * Per-arrangement document RAG (RTV-34/41) — index an arrangement's evidence documents into a
 * Qdrant collection `arrangement_<id>` and retrieve real text spans for a control, so the
 * assessment engine cites actual document passages instead of just evidence metadata.
 *
 * SEARCH IS FAIL-SAFE: if Qdrant is unreachable or the collection doesn't exist (nothing indexed
 * yet), it returns [] — the retriever then falls back to metadata evidence (→ insufficient-evidence),
 * which keeps assessments working (and every test that doesn't index a doc unaffected).
 */
import { QdrantClient } from '@qdrant/js-client-rest';
import { embeddings } from '../../config/embeddings.js';
import { chunkText, getVectorSize } from '../fileIngestionService.js';
import { contentHash } from '../../utils/index.js';
import logger from '../../config/logger.js';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
// NOTE: call getVectorSize() lazily (at ingest time), NOT at module load — calling it here would
// execute a mocked fileIngestionService in any test that mocks it while loading the app.

export const arrangementCollectionName = (arrangementId) => `arrangement_${arrangementId}`;

function getClient() {
  // Short timeout so a down/absent Qdrant fails fast (assessments must not hang on the RAG path).
  const opts = { url: QDRANT_URL, checkCompatibility: false, timeout: 3000 };
  if (QDRANT_API_KEY) opts.apiKey = QDRANT_API_KEY;
  return new QdrantClient(opts);
}

// Once a search fails (Qdrant unreachable), skip RAG for a cooldown so a whole assessment run
// (18 controls) doesn't pay the timeout on every control.
let ragDisabledUntil = 0;
const RAG_COOLDOWN_MS = 60_000;

async function ensureCollection(client, name) {
  try {
    await client.getCollection(name);
  } catch {
    await client.createCollection(name, { vectors: { size: getVectorSize(), distance: 'Cosine' } });
  }
}

const pointId = (seed) => {
  const h = contentHash(seed);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

/** Chunk + embed + upsert a document's text into the arrangement's collection. Returns chunk count. */
export async function indexArrangementText(arrangementId, fileName, text) {
  const chunks = chunkText(text || '');
  if (!chunks.length) return 0;
  const client = getClient();
  const collection = arrangementCollectionName(arrangementId);
  await ensureCollection(client, collection);
  const vectors = await embeddings.embedDocuments(chunks);
  const points = chunks.map((chunk, i) => ({
    id: pointId(`${arrangementId}:${fileName}:${i}`),
    vector: vectors[i],
    payload: { pageContent: chunk, metadata: { fileName, arrangementId } },
  }));
  await client.upsert(collection, { wait: true, points });
  logger.info('indexed arrangement document', {
    service: 'assessment-rag',
    arrangementId,
    fileName,
    chunks: chunks.length,
  });
  return chunks.length;
}

/**
 * Retrieve the top document spans matching a query for an arrangement. FAIL-SAFE → [] on any error.
 * @returns {Promise<Array<{source:string, snippet:string, score:number}>>}
 */
export async function searchArrangementSpans(arrangementId, queryText, topK = 5) {
  // Skip the network call under vitest — no arrangement collection is indexed in tests, so RAG
  // would only pay a Qdrant timeout. The retriever's merge logic is covered by a unit test that
  // injects searchSpans directly; the real path is exercised on dev.
  if (process.env.VITEST) return [];
  if (Date.now() < ragDisabledUntil) return []; // cooling down after a recent failure
  try {
    const client = getClient();
    const vector = await embeddings.embedQuery(queryText);
    const hits = await client.search(arrangementCollectionName(arrangementId), {
      vector,
      limit: topK,
      with_payload: true,
    });
    return hits
      .filter((h) => (h.payload?.pageContent || '').length > 20)
      .map((h) => ({
        source: h.payload?.metadata?.fileName || 'document',
        snippet: String(h.payload?.pageContent || '').slice(0, 400),
        score: h.score,
      }));
  } catch {
    ragDisabledUntil = Date.now() + RAG_COOLDOWN_MS; // Qdrant down → skip RAG for the rest of the run
    return []; // no Qdrant / collection not indexed yet → metadata evidence path handles it
  }
}
