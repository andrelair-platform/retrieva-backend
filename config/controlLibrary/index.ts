/**
 * Control Library loader/registry (RTV-39, ADR §4).
 *
 * The library is versioned JSON committed to the repo (data/compliance/control-library/<version>.json)
 * — the reviewable, immutable-per-version source of truth. This module imports every version, validates
 * it on load (a malformed control set throws at startup), and exposes them by version so a stamped past
 * assessment (RTV-41) can always resolve the exact library it was assessed against.
 *
 * Adding a new version: drop `vX.Y.Z.json` in the data dir, import it below, and bump CURRENT.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { parseControlLibrary } from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data/compliance/control-library');

function load(version: string) {
  const raw = JSON.parse(readFileSync(path.join(DATA_DIR, `v${version}.json`), 'utf-8'));
  const lib = parseControlLibrary(raw); // validate on load — fail fast on a bad shape
  if (lib.libraryVersion !== version) {
    throw new Error(
      `control-library ${version}.json declares libraryVersion="${lib.libraryVersion}"`
    );
  }
  return Object.freeze(lib);
}

// Registry of all known versions. Every stamped version must stay resolvable (immutability).
export const LIBRARY_VERSIONS = Object.freeze({
  '1.0.0': load('1.0.0'),
});

// The version new assessments are stamped with (RTV-41). Bump on a new library release.
export const CURRENT_LIBRARY_VERSION = '1.0.0';
