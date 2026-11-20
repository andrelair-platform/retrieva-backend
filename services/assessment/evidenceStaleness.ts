/**
 * Evidence staleness classifier (Workflow C trigger #7) — PURE, no DB. A previously-approved assessment
 * silently rots when the evidence it relied on expires (a SOC 2 / ISO 27001 cert with a `validityUntil`
 * in the past, or expiring within the grace window). This classifies an evidence record's validity so a
 * scheduled sweep can reopen the arrangement for review BEFORE the gap is discovered in an audit — never
 * "someone has to notice the cert lapsed". `now` is injected for deterministic tests.
 *
 * @module services/assessment/evidenceStaleness
 */
export type EvidenceValidity = 'ok' | 'expiring' | 'expired' | 'no-expiry';

export interface EvidenceLike {
  id?: string;
  validityUntil?: Date | string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Classify one record: expired (past validity) / expiring (within grace) / ok / no-expiry (untracked). */
export function classifyEvidenceValidity(
  validityUntil: Date | string | null | undefined,
  now: Date,
  graceDays: number
): EvidenceValidity {
  if (!validityUntil) return 'no-expiry';
  const until = validityUntil instanceof Date ? validityUntil : new Date(validityUntil);
  if (Number.isNaN(until.getTime())) return 'no-expiry';
  const graceEdge = new Date(now.getTime() + graceDays * DAY_MS);
  if (until.getTime() <= now.getTime()) return 'expired';
  if (until.getTime() <= graceEdge.getTime()) return 'expiring';
  return 'ok';
}

/** True when a record warrants action (expired or within the renewal grace window). */
export function evidenceNeedsRenewal(
  validityUntil: Date | string | null | undefined,
  now: Date,
  graceDays: number
): boolean {
  const v = classifyEvidenceValidity(validityUntil, now, graceDays);
  return v === 'expired' || v === 'expiring';
}

/**
 * Reduce a set of evidence records for ONE arrangement to a renewal summary: are any expired/expiring,
 * which, and the worst state. Pure — the sweep passes the DB rows; this decides whether to reopen.
 */
export function summariseStaleEvidence(
  records: ReadonlyArray<EvidenceLike>,
  now: Date,
  graceDays: number
): { needsRenewal: boolean; expired: EvidenceLike[]; expiring: EvidenceLike[] } {
  const expired: EvidenceLike[] = [];
  const expiring: EvidenceLike[] = [];
  for (const r of records) {
    const v = classifyEvidenceValidity(r.validityUntil, now, graceDays);
    if (v === 'expired') expired.push(r);
    else if (v === 'expiring') expiring.push(r);
  }
  return { needsRenewal: expired.length > 0 || expiring.length > 0, expired, expiring };
}
