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

const cell = (v) => (v === undefined || v === null ? '' : v);

/** Array-of-arrays for one template: [header row, ...data rows] per the versioned field map. */
function templateAoa(readModel, templateKey) {
  const def = RT0201_TEMPLATES[templateKey];
  const header = def.columns.map((c) => `${c.code} ${c.label}`);
  const rows = (readModel.templates[templateKey] || []).map((row) =>
    def.columns.map((c) => cell(c.source(row)))
  );
  return [header, ...rows];
}

/** CSV text for a single template (deterministic — the golden-file target). */
export function generateRegisterCsv(readModel, templateKey) {
  if (!RT0201_TEMPLATES[templateKey]) {
    throw new Error(`Unknown register template: ${templateKey}`);
  }
  const sheet = XLSX.utils.aoa_to_sheet(templateAoa(readModel, templateKey));
  return XLSX.utils.sheet_to_csv(sheet);
}

/** XLSX workbook: one sheet per template + a Gaps sheet. Returns a Buffer. */
export function generateRegisterWorkbook(readModel) {
  const wb = XLSX.utils.book_new();
  for (const key of RT0201_TEMPLATE_ORDER) {
    const def = RT0201_TEMPLATES[key];
    const sheet = XLSX.utils.aoa_to_sheet(templateAoa(readModel, key));
    XLSX.utils.book_append_sheet(wb, sheet, def.sheet);
  }
  // Gaps sheet — required fields the graph can't yet satisfy (AC-4), never silently dropped.
  const gapRows = [
    ['Template', 'Field code', 'Field', 'Record', 'Reason'],
    ...readModel.gaps.map((g) => [g.template, g.code, g.label, cell(g.ref), g.reason]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(gapRows), 'Gaps');

  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
}
