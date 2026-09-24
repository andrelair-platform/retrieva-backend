import type { Request, Response, NextFunction } from "express";
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { buildRegister } from '../../services/registerProjectionService.js';
import {
  generateRegisterWorkbook,
  generateRegisterCsv,
} from '../../services/registerExportService.js';
import { RT0201_TEMPLATES } from '../../config/register/rt0201FieldMap.js';

// The Register is ORG-scoped (spans the firm's whole arrangement graph). Every handler keys off
// req.user!.organizationId — never a caller-supplied org id — so tenants can't cross. Row-level
// entity isolation (RTV-54) is applied by the graph repos via setEntityContext on the router.
const orgId = (req: Request) => req.user?.organizationId as string;
const requireOrg = (req: Request, res: Response) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this user');
  return id;
};

// GET /api/v1/register — the RT.02.01 read model (templates + gaps), generated on demand from
// live graph state (ADR §2: "the Register falls out of the graph").
export const getRegister = catchAsync(async (req: Request, res: Response) => {
  const id = requireOrg(req, res);
  if (!id) return;
  const register = await buildRegister(id);
  sendSuccess(res, 200, 'Register of Information (RT.02.01)', register);
});

// GET /api/v1/register/export?format=xlsx|csv[&template=B_02]
//   xlsx (default) → full workbook (one sheet per template + Gaps)
//   csv            → one template's CSV (requires &template=)
export const exportRegister = catchAsync(async (req: Request, res: Response) => {
  const id = requireOrg(req, res);
  if (!id) return;
  const register = await buildRegister(id);
  const dateStr = new Date().toISOString().slice(0, 10);
  const format = String(req.query.format || 'xlsx').toLowerCase();

  if (format === 'csv') {
    const template = String(req.query.template || '');
    if (!RT0201_TEMPLATES[template as keyof typeof RT0201_TEMPLATES]) {
      return sendError(
        res,
        400,
        `csv export requires a valid &template= (one of: ${Object.keys(RT0201_TEMPLATES).join(', ')})`
      );
    }
    const csv = generateRegisterCsv(register, template);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="RT0201_${template}_${dateStr}.csv"`
    );
    return res.end(csv);
  }

  if (format !== 'xlsx') {
    return sendError(res, 400, "format must be 'xlsx' or 'csv'");
  }

  const buffer = generateRegisterWorkbook(register);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="DORA_Register_of_Information_${dateStr}.xlsx"`
  );
  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
});
