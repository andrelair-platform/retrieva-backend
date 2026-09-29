/**
 * Decision queue (RTV-67) — the pure builder behind the human's decision inbox. Retrieva's stance:
 * the AI drafts, the HUMAN decides. This merges everything the AI concluded that is still awaiting a
 * decision — draft findings (RTV-55) + open risks (RTV-43) — into ONE cross-arrangement queue, so a
 * risk officer's job is to decide, not to navigate per-arrangement pages.
 *
 * Ordering: most-uncertain / most-severe first. A finding's urgency is 1 − confidence (the LEAST
 * confident AI reading needs a human most — "sorted low-confidence first"); a risk's urgency is its
 * severity rank. One list, so criticals and low-confidence drafts both surface at the top.
 *
 * Pure + injectable: the controller resolves the arrangement→provider context maps and passes them
 * in, so this stays unit-testable with no DB.
 */

const SEVERITY_RANK: Record<string, number> = { critical: 1, high: 0.8, medium: 0.5, low: 0.3 };

export interface QueueContext {
  // arrangementId → { providerName, businessFunctionName } (already entity-scoped by the caller)
  arrangementContext: Map<string, { providerName: string; businessFunctionName: string }>;
}

export interface DecisionItem {
  kind: 'finding' | 'risk';
  id: string;
  arrangementId: string;
  providerName: string;
  businessFunctionName: string;
  controlId: string;
  urgency: number; // 0..1, higher = surfaces first
  createdAt: unknown;
  // finding-only
  verdict?: string;
  confidence?: number | null;
  rationale?: string;
  citations?: unknown;
  // risk-only
  severity?: string;
  sourceVerdict?: string;
  title?: string;
  description?: string;
  status?: string;
}

const ctxFor = (m: QueueContext['arrangementContext'], id: string) =>
  m.get(id) || { providerName: '(unknown provider)', businessFunctionName: '' };

/**
 * Merge draft findings + open risks into one urgency-sorted decision queue.
 * @param findings draft findings (AI-drafted, undecided)
 * @param risks    open risks (approved gaps awaiting the human's remediation decision)
 */
export function buildDecisionQueue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- persisted rows are heterogeneous
  findings: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  risks: any[],
  ctx: QueueContext
): { items: DecisionItem[]; counts: { findings: number; risks: number; total: number } } {
  const findingItems: DecisionItem[] = findings.map((f) => {
    const c = ctxFor(ctx.arrangementContext, f.arrangementId);
    const confidence = typeof f.confidence === 'number' ? f.confidence : null;
    return {
      kind: 'finding',
      id: f.id,
      arrangementId: f.arrangementId,
      providerName: c.providerName,
      businessFunctionName: c.businessFunctionName,
      controlId: f.controlId,
      urgency: 1 - (confidence ?? 0), // low confidence → high urgency (top)
      createdAt: f.createdAt,
      verdict: f.verdict,
      confidence,
      rationale: f.rationale ?? '',
      citations: f.citations ?? [],
    };
  });

  const riskItems: DecisionItem[] = risks.map((r) => {
    const c = ctxFor(ctx.arrangementContext, r.arrangementId);
    return {
      kind: 'risk',
      id: r.id,
      arrangementId: r.arrangementId,
      providerName: c.providerName,
      businessFunctionName: c.businessFunctionName,
      controlId: r.controlId,
      urgency: SEVERITY_RANK[r.severity] ?? 0.3,
      createdAt: r.createdAt,
      severity: r.severity,
      sourceVerdict: r.sourceVerdict,
      title: r.title,
      description: r.description ?? '',
      status: r.status,
    };
  });

  const items = [...findingItems, ...riskItems].sort((a, b) => {
    if (b.urgency !== a.urgency) return b.urgency - a.urgency; // most urgent first
    // tiebreak: older first (waited longest for a decision)
    return new Date(a.createdAt as string).getTime() - new Date(b.createdAt as string).getTime();
  });

  return {
    items,
    counts: { findings: findingItems.length, risks: riskItems.length, total: items.length },
  };
}

/**
 * The ids of finding items the AI is confident about (≥ threshold) — the candidates for the
 * "accept all high-confidence" bulk action (RTV-67). Pure; the SoD/audit-safe apply is a follow-up.
 */
export function highConfidenceFindingIds(items: DecisionItem[], threshold = 0.8): string[] {
  return items
    .filter((i) => i.kind === 'finding' && typeof i.confidence === 'number' && i.confidence >= threshold)
    .map((i) => i.id);
}
