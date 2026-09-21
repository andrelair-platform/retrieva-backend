import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { assessmentQueue } from '../../config/queue.js';
import { findingRepository } from '../../repositories/index.js';

// The assessment engine is ORG-scoped and arrangement-centric (RTV-41). Every handler keys off
// req.user.organizationId — never a caller-supplied org — so tenants can't cross. Row-level
// entity isolation (RTV-54) applies to the findings reads via setEntityContext on the router.
const orgId = (req) => req.user?.organizationId;
const requireOrg = (req, res) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this user');
  return id;
};

// POST /api/v1/arrangements/:arrangementId/assessment — enqueue an evidence-grounded assessment.
// LLM-per-control is slow, so it runs async on the assessment queue (like gap analysis); poll the
// findings endpoint for results.
export const runAssessment = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const { arrangementId } = req.params;
  const job = await assessmentQueue.add('arrangementAssessment', {
    organizationId,
    arrangementId,
    userId: req.user.userId,
  });
  sendSuccess(res, 202, 'Assessment queued', { jobId: job.id, arrangementId });
});

// GET /api/v1/arrangements/:arrangementId/findings — the per-control verdicts (drafts).
export const getFindings = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const findings = await findingRepository.listByArrangement(organizationId, req.params.arrangementId);
  sendSuccess(res, 200, 'Assessment findings', { findings });
});
