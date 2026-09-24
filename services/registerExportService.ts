/**
 * Register of Information (RT.02.01) exporter (RTV-38).
 *
 * Renders the read model from registerProjectionService (assembleRegister/buildRegister) to the
 * EBA template structure — XLSX (one sheet per template + a Gaps sheet) or CSV per template
 * (AC-2). Pure formatting over the read model; all data/gap logic lives in the projection service.
 * Reuses SheetJS (`xlsx`), matching services/roiExportService.js.
 */
import XLSX from 'xlsx';
import { RT0201_TEMPLATES, RT0201_TEMPLATE_ORDER } from '../config/register/rt0201FieldMap.js';

type TemplateKey = keyof typeof RT0201_TEMPLATES;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the register read model is a heterogeneous projection
type ReadModel = any;

const cell = (v: unknown) => (v === undefined || v === null ? '' : v);

/** Array-of-arrays for one template: [header row, ...data rows] per the versioned field map. */
function templateAoa(readModel: ReadModel, templateKey: TemplateKey) {
  const def = RT0201_TEMPLATES[templateKey];
  const header = def.columns.map((c) => `${c.code} ${c.label}`);
  const rows = (readModel.templates[templateKey] || []).map((row: ReadModel) =>
    def.columns.map((c) => cell(c.source(row)))
  );
  return [header, ...rows];
}

/** CSV text for a single template (deterministic — the golden-file target). */
export function generateRegisterCsv(readModel: ReadModel, templateKey: string) {
  if (!RT0201_TEMPLATES[templateKey as TemplateKey]) {
    throw new Error(`Unknown register template: ${templateKey}`);
  }
  const sheet = XLSX.utils.aoa_to_sheet(templateAoa(readModel, templateKey as TemplateKey));
  return XLSX.utils.sheet_to_csv(sheet);
}

/** XLSX workbook: one sheet per template + a Gaps sheet. Returns a Buffer. */
export function generateRegisterWorkbook(readModel: ReadModel) {
  const wb = XLSX.utils.book_new();
  for (const key of RT0201_TEMPLATE_ORDER as TemplateKey[]) {
    const def = RT0201_TEMPLATES[key];
    const sheet = XLSX.utils.aoa_to_sheet(templateAoa(readModel, key));
    XLSX.utils.book_append_sheet(wb, sheet, def.sheet);
  }
  // Gaps sheet — required fields the graph can't yet satisfy (AC-4), never silently dropped.
  const gapRows = [
    ['Template', 'Field code', 'Field', 'Record', 'Reason'],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- gap rows are heterogeneous
    ...readModel.gaps.map((g: any) => [g.template, g.code, g.label, cell(g.ref), g.reason]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(gapRows), 'Gaps');

  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
}
