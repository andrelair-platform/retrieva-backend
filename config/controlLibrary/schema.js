/**
 * Control Library schema (RTV-39, ADR §4). The library is versioned structured DATA — validated
 * on load so a malformed control set fails fast (cert-defensible: "the controls are inspectable").
 */
import { z } from 'zod';

// A control's applicability drives DORA proportionality (AC-4):
//  - baseline       → applies to every arrangement
//  - cif_mandatory  → applies (required) only when the arrangement supports a critical/important function
//  - cif_enhanced   → an enhanced obligation that applies only for CIF arrangements
export const CONTROL_APPLICABILITY = ['baseline', 'cif_mandatory', 'cif_enhanced'];

export const controlSchema = z.object({
  id: z.string().min(1), // stable control id, e.g. "DORA-28.4-DUE-DILIGENCE"
  doraArticleRef: z.string().min(1), // precise citation for RTV-41, e.g. "Article 28(4)"
  domain: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  expectedEvidenceTypes: z.array(z.string().min(1)).min(1),
  clauseMatchPatterns: z.array(z.string().min(1)).min(1),
  applicability: z.enum(CONTROL_APPLICABILITY),
});

export const controlLibrarySchema = z.object({
  libraryVersion: z.string().regex(/^\d+\.\d+\.\d+$/), // semver, immutable per version
  regulation: z.string().min(1),
  publishedAt: z.string().min(1),
  controls: z.array(controlSchema).min(1),
});

/** Parse + validate a raw library object; throws a readable error on a bad shape. */
export function parseControlLibrary(raw) {
  return controlLibrarySchema.parse(raw);
}
