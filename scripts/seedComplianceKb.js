#!/usr/bin/env node
/**
 * seedComplianceKb.js
 *
 * Embeds DORA regulation articles + EBA/ESMA/EIOPA RTS entries into the
 * shared, read-only Qdrant collection: `compliance_kb`.
 *
 * NON-DESTRUCTIVE (retrieva-backend#433): every entry gets a DETERMINISTIC point id
 * (regulation+article+lang), so a re-seed UPSERTS in place and a slow/failed embed can
 * never empty the collection (the June-2026 incident wiped compliance_kb because the old
 * path did deleteCollection() before re-embedding). Entries are embedded + upserted one at
 * a time; stale points (no longer in the JSON) are pruned AFTER the upsert.
 *
 * Modes:
 *   node backend/scripts/seedComplianceKb.js
 *       Smart sync (default) — skips if Qdrant point count matches JSON article count,
 *       otherwise upserts every entry in place. Creates the collection only if missing.
 *
 *   node backend/scripts/seedComplianceKb.js --reset
 *       Force a full re-embed of every entry (also in place — no delete window). Use when
 *       article text has been updated (not just new articles added).
 *
 * The collection is shared across all assessments (read-only reference data).
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { v5 as uuidv5 } from 'uuid';
import { QdrantClient } from '@qdrant/js-client-rest';
import { OllamaEmbeddings } from '@langchain/ollama';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
export const COMPLIANCE_KB_COLLECTION = 'compliance_kb';
// Embeddings prefer the dedicated EMBEDDING_OLLAMA_BASE_URL so a self-hosted
// embedding endpoint can be used while chat goes through Ollama Cloud.
// Matches the precedence in backend/config/embeddings.js.
const OLLAMA_BASE_URL =
  process.env.EMBEDDING_OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_API_KEY =
  process.env.OLLAMA_API_KEY_1 ||
  process.env.OLLAMA_API_KEY_2 ||
  process.env.OLLAMA_API_KEY_3 ||
  process.env.OLLAMA_API_KEY;
const OLLAMA_AUTH_HEADERS = OLLAMA_API_KEY
  ? { Authorization: `Bearer ${OLLAMA_API_KEY}` }
  : undefined;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'bge-m3:latest';
const VECTOR_SIZE = 1024; // bge-m3 output dimension

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getQdrantClient() {
  const opts = { url: QDRANT_URL, checkCompatibility: false };
  if (QDRANT_API_KEY) opts.apiKey = QDRANT_API_KEY;
  return new QdrantClient(opts);
}

function getEmbeddings() {
  return new OllamaEmbeddings({
    model: EMBEDDING_MODEL,
    baseUrl: OLLAMA_BASE_URL,
    headers: OLLAMA_AUTH_HEADERS,
  });
}

/**
 * Load one knowledge-base file, tagging every article with its language and
 * whether it's the official text. Returns null if the file is absent (e.g. the
 * French translation hasn't been generated yet).
 */
function loadOne(fileName, defaultLang) {
  const filePath = path.join(__dirname, '../data/compliance/', fileName);
  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
  const articles = Array.isArray(raw) ? raw : raw.articles;
  const lang = (!Array.isArray(raw) && raw.lang) || defaultLang;
  const official = Array.isArray(raw) ? true : raw.official !== false;
  const meta = Array.isArray(raw)
    ? { version: '1.0', lastVerified: null, sources: [] }
    : { version: raw.version, lastVerified: raw.lastVerified, sources: raw.sources || [] };
  return { articles: articles.map((a) => ({ ...a, lang, official })), meta };
}

/**
 * Load the knowledge base across all available languages (English + the optional
 * working French translation). Returns { articles, meta }.
 */
function loadData() {
  const en = loadOne('dora-articles.json', 'en');
  const fr = loadOne('dora-articles.fr.json', 'fr');
  const articles = [...(en?.articles || []), ...(fr?.articles || [])];
  return { articles, meta: en?.meta || { version: '1.0', lastVerified: null, sources: [] } };
}

/**
 * Build the text we embed for each article.
 * Combines header + obligations + full text for maximum retrieval coverage.
 */
function buildEmbedText(article) {
  const obligationsText = article.obligations?.join('; ') || '';
  return [
    `${article.regulation} ${article.article}: ${article.title}`,
    `Domain: ${article.domain}`,
    `Key obligations: ${obligationsText}`,
    article.text,
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function collectionExists(client) {
  try {
    await client.getCollection(COMPLIANCE_KB_COLLECTION);
    return true;
  } catch {
    return false;
  }
}

async function getCollectionPointCount(client) {
  try {
    const info = await client.getCollection(COMPLIANCE_KB_COLLECTION);
    return info.points_count || 0;
  } catch {
    return 0;
  }
}

async function createCollection(client) {
  await client.createCollection(COMPLIANCE_KB_COLLECTION, {
    vectors: {
      size: VECTOR_SIZE,
      distance: 'Cosine',
    },
    optimizers_config: { default_segment_number: 2 },
    replication_factor: 1,
  });
  console.log(`Created Qdrant collection: ${COMPLIANCE_KB_COLLECTION}`);
}

// Deterministic point id per article (regulation+article+lang) so a re-seed UPSERTS in
// place instead of appending duplicates — this is what makes delete-first unnecessary (#433).
const ID_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';
function pointId(article) {
  return uuidv5(`${article.regulation}::${article.article}::${article.lang || 'en'}`, ID_NAMESPACE);
}

/**
 * Non-destructive upsert (retrieva-backend#433): embed + upsert ONE entry at a time with a
 * deterministic id, so the collection is NEVER emptied — a slow/failed embed leaves the
 * previously-good points intact, and the count climbs incrementally. Returns the id set for
 * pruning. (The old path did deleteCollection() first + a single batch embed, so any embed
 * failure wiped compliance_kb; see the #433 incident.)
 */
async function embedAndUpsert(client, articles) {
  const embeddings = getEmbeddings();
  const keepIds = new Set();
  let done = 0;

  console.log(`Upserting ${articles.length} entries in place (non-destructive)…`);
  for (const article of articles) {
    const text = buildEmbedText(article);
    const id = pointId(article);
    keepIds.add(id);
    const [vector] = await embeddings.embedDocuments([text]);
    await client.upsert(COMPLIANCE_KB_COLLECTION, {
      wait: true,
      points: [
        {
          id,
          vector,
          payload: {
            pageContent: text,
            metadata: {
              regulation: article.regulation,
              article: article.article,
              title: article.title,
              domain: article.domain,
              obligations: article.obligations || [],
              fullText: article.text,
              lang: article.lang || 'en',
              official: article.official !== false,
            },
          },
        },
      ],
    });
    done++;
    if (done % 10 === 0 || done === articles.length) {
      console.log(`  upserted ${done}/${articles.length}`);
    }
  }
  return keepIds;
}

/** Delete points whose id is no longer in the current article set (handles removed/renamed
 *  entries) — run AFTER the upsert so the KB is never smaller than it needs to be. */
async function pruneStalePoints(client, keepIds) {
  const stale = [];
  let offset = undefined;
  do {
    const res = await client.scroll(COMPLIANCE_KB_COLLECTION, {
      limit: 256,
      offset,
      with_payload: false,
      with_vector: false,
    });
    for (const p of res.points) if (!keepIds.has(String(p.id))) stale.push(p.id);
    offset = res.next_page_offset ?? undefined;
  } while (offset);

  if (stale.length) {
    await client.delete(COMPLIANCE_KB_COLLECTION, { wait: true, points: stale });
    console.log(`Pruned ${stale.length} stale point(s).`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function seed() {
  const args = process.argv.slice(2);
  const forceReset = args.includes('--reset');

  const client = getQdrantClient();
  const { articles, meta } = loadData();

  console.log(`Connecting to Qdrant at ${QDRANT_URL}…`);
  console.log(`Knowledge base: v${meta.version}, lastVerified: ${meta.lastVerified || 'unknown'}`);
  console.log(`Total entries to sync: ${articles.length}`);

  const exists = await collectionExists(client);

  // Create the collection only if it's missing — NEVER delete an existing one (#433: a
  // delete-first re-seed that then failed to embed left compliance_kb empty in prod).
  if (!exists) {
    await createCollection(client);
  } else if (!forceReset) {
    // Smart sync: if the point count already matches, nothing to do.
    const currentCount = await getCollectionPointCount(client);
    if (currentCount === articles.length) {
      console.log(
        `✓ Collection "${COMPLIANCE_KB_COLLECTION}" is up to date (${currentCount} points = ${articles.length} entries). No action needed.`
      );
      process.exit(0);
    }
    console.log(
      `Point count mismatch — Qdrant: ${currentCount}, JSON: ${articles.length}. Upserting in place…`
    );
  } else {
    // --reset forces a full re-embed of every entry, but still in place (no delete window).
    console.log('--reset: forcing a full re-embed (in place, non-destructive)…');
  }

  // Upsert-in-place (deterministic ids), then prune anything no longer in the JSON. A failed
  // embed here leaves the previously-good collection intact rather than empty.
  const keepIds = await embedAndUpsert(client, articles);
  await pruneStalePoints(client, keepIds);

  console.log(`\n✓ Synced ${articles.length} entries into "${COMPLIANCE_KB_COLLECTION}".`);

  // Print domain summary
  const byRegulation = articles.reduce((acc, a) => {
    acc[a.regulation] = (acc[a.regulation] || 0) + 1;
    return acc;
  }, {});
  console.log('Regulation breakdown:');
  for (const [reg, count] of Object.entries(byRegulation)) {
    console.log(`  - ${reg}: ${count} entries`);
  }

  const domains = [...new Set(articles.map((a) => a.domain))];
  console.log('Domains indexed:');
  for (const d of domains) {
    const count = articles.filter((a) => a.domain === d).length;
    console.log(`  - ${d}: ${count} entries`);
  }

  process.exit(0);
}

// Exported for tests. Only auto-run when invoked directly (not when imported), so a test
// can import the helpers without executing the seed.
export { pointId, embedAndUpsert, pruneStalePoints, buildEmbedText };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seed().catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
  });
}
