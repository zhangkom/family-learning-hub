/** Portable, reviewed worksheet content. Math is an expression tree, never a screenshot. */
export type WorksheetMath =
  | { kind: 'text'; text: string; upright?: boolean; bold?: boolean }
  | { kind: 'row'; items: WorksheetMath[] }
  | { kind: 'fraction'; numerator: WorksheetMath; denominator: WorksheetMath }
  | { kind: 'script'; base: WorksheetMath; sub?: WorksheetMath; sup?: WorksheetMath }
  | { kind: 'prescript'; base: WorksheetMath; sub?: WorksheetMath; sup?: WorksheetMath }
  | { kind: 'root'; value: WorksheetMath; degree?: WorksheetMath }
  | { kind: 'accent'; value: WorksheetMath; mark: 'bar' | 'vector' | 'hat' }
  | { kind: 'bracket'; value: WorksheetMath; left: '(' | '[' | '{' | '|'; right: ')' | ']' | '}' | '|' }
  | { kind: 'matrix'; rows: WorksheetMath[][] };
export type WorksheetInline = { text: string; italic?: boolean; bold?: boolean; sub?: boolean; sup?: boolean; underline?: 'single' | 'wave' } | { math: WorksheetMath };
export type WorksheetDrawing = {
  width: number; height: number; description: string;
  elements: ((
    | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; dashed?: boolean; arrow?: boolean }
    | { kind: 'polyline'; points: [number, number][]; closed?: boolean; dashed?: boolean; fill?: 'white' | 'gray' | 'black' }
    | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill?: 'white' | 'gray' | 'black' }
    | { kind: 'label'; x: number; y: number; text: string; italic?: boolean; size?: number }
  ) & { strokeWidth?: number })[];
};
export type WorksheetBlock =
  | { kind: 'paragraph'; inlines: WorksheetInline[]; keepWithNext?: boolean }
  | { kind: 'equation'; math: WorksheetMath }
  | { kind: 'figure'; drawing: WorksheetDrawing; widthMm: number }
  /** A real photograph from this question's versioned scan only; no external image input. */
  | { kind: 'sourcePhoto'; crop: { x: number; y: number; width: number; height: number }; description: string; widthMm: number }
  | { kind: 'table'; rows: WorksheetInline[][][]; columnWidths?: number[] };
export type PreparedWorksheetQuestion = {
  version: 1;
  sourceFingerprint: string;
  blocks: WorksheetBlock[];
  /** Long shared passages/experiment conditions print once, separately from answerable questions. */
  sharedMaterial?: { id: string; title: string; blocks: WorksheetBlock[] };
  /** Optional verified answer appendix, never inserted into the student's question body. */
  answerBlocks?: WorksheetBlock[];
  answerSpaceMm: number;
  reviewedAt: string;
  reviewedBy: string;
  verificationNote: string;
};
export type WorksheetSelection = { scanId: string; questionId: string; revision: number };
export type WorksheetExportInput = { studentId: string; selections: WorksheetSelection[]; includeAnswers?: boolean };
export type WorksheetAvailability = {
  scanId: string; questionId: string; revision: number; sourceTitle: string; originalNumber: string;
  subject: string; stars: number; ready: boolean; reasons: string[]; sourceFingerprint: string;
};
export type WorksheetPreview = { items: WorksheetAvailability[]; readyCount: number; totalCount: number };

function fail(message: string): never { throw new Error(message); }
function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail('排版内容格式不正确');
}
function str(value: unknown, max: number, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail('排版文字为空、过长或含无效字符');
  for (let i = 0; i < (value as string).length; i++) { const c = (value as string).charCodeAt(i); if (c < 32 && ![9, 10, 13].includes(c)) fail('排版文字含无效字符'); }
  return value as string;
}
function array(value: unknown, max: number) {
  if (!Array.isArray(value) || !value.length || value.length > max) fail('排版内容数量不正确');
  return value as unknown[];
}
function number(value: unknown, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('排版尺寸超出范围');
  return value as number;
}
function flag(value: unknown) { if (value !== undefined && typeof value !== 'boolean') fail('排版样式无效'); return value === true; }
export function validateWorksheetMath(value: unknown, depth = 0): WorksheetMath {
  if (depth > 14) fail('公式嵌套过深');
  const m = obj(value), child = (v: unknown) => validateWorksheetMath(v, depth + 1);
  switch (m.kind) {
    case 'text': return { kind: 'text', text: str(m.text, 400), upright: flag(m.upright), bold: flag(m.bold) };
    case 'row': return { kind: 'row', items: array(m.items, 100).map(child) };
    case 'fraction': return { kind: 'fraction', numerator: child(m.numerator), denominator: child(m.denominator) };
    case 'script': if (!m.sub && !m.sup) fail('上下标不能为空'); return { kind: 'script', base: child(m.base), ...(m.sub ? { sub: child(m.sub) } : {}), ...(m.sup ? { sup: child(m.sup) } : {}) };
    case 'prescript': if (!m.sub && !m.sup) fail('左上下标不能为空'); return { kind: 'prescript', base: child(m.base), ...(m.sub ? { sub: child(m.sub) } : {}), ...(m.sup ? { sup: child(m.sup) } : {}) };
    case 'root': return { kind: 'root', value: child(m.value), ...(m.degree ? { degree: child(m.degree) } : {}) };
    case 'accent': if (!['bar', 'vector', 'hat'].includes(String(m.mark))) fail('公式重音无效'); return { kind: 'accent', value: child(m.value), mark: m.mark as 'bar' | 'vector' | 'hat' };
    case 'bracket': if (!['(', '[', '{', '|'].includes(String(m.left)) || ![')', ']', '}', '|'].includes(String(m.right))) fail('公式括号无效'); return { kind: 'bracket', value: child(m.value), left: m.left as '(', right: m.right as ')' };
    case 'matrix': {
      const rows = array(m.rows, 12).map(row => array(row, 12).map(child));
      if (rows.some(row => row.length !== rows[0].length)) fail('公式矩阵列数不一致');
      return { kind: 'matrix', rows };
    }
    default: return fail('不支持的公式结构');
  }
}
function inline(value: unknown): WorksheetInline {
  const v = obj(value);
  if (v.math !== undefined) return { math: validateWorksheetMath(v.math) };
  if (v.sub && v.sup) fail('普通文字不能同时上下标');
  if (v.underline !== undefined && v.underline !== 'single' && v.underline !== 'wave') fail('文字划线样式无效');
  return { text: str(v.text, 16000, true), italic: flag(v.italic), bold: flag(v.bold), sub: flag(v.sub), sup: flag(v.sup), ...(v.underline ? { underline: v.underline as 'single' | 'wave' } : {}) };
}
export function validateWorksheetDrawing(value: unknown): WorksheetDrawing {
  const d = obj(value), width = number(d.width, 50, 2000), height = number(d.height, 30, 2000);
  const x = (v: unknown) => number(v, 0, width), y = (v: unknown) => number(v, 0, height);
  const fill = (v: unknown) => { if (v !== undefined && (typeof v !== 'string' || !['white', 'gray', 'black'].includes(v))) fail('配图填色无效'); return v as 'white' | 'gray' | 'black' | undefined; };
  const elements: WorksheetDrawing['elements'] = array(d.elements, 1000).map(value => {
    const e = obj(value);
    const style = e.strokeWidth === undefined ? {} : { strokeWidth: number(e.strokeWidth, 0.2, 6) };
    switch (e.kind) {
      case 'line': return { kind: 'line', x1: x(e.x1), y1: y(e.y1), x2: x(e.x2), y2: y(e.y2), arrow: flag(e.arrow), dashed: flag(e.dashed), ...style };
      case 'ellipse': {
        const cx = x(e.cx), cy = y(e.cy), rx = number(e.rx, 0.1, width / 2), ry = number(e.ry, 0.1, height / 2);
        if (cx - rx < 0 || cy - ry < 0 || cx + rx > width || cy + ry > height) fail('配图椭圆超出边界');
        return { kind: 'ellipse', cx, cy, rx, ry, fill: fill(e.fill), ...style };
      }
      case 'polyline': return { kind: 'polyline', points: array(e.points, 1000).map(point => { const p = array(point, 2); if (p.length !== 2) fail('配图坐标无效'); return [x(p[0]), y(p[1])] as [number, number]; }), closed: flag(e.closed), dashed: flag(e.dashed), fill: fill(e.fill), ...style };
      case 'label': return { kind: 'label', x: x(e.x), y: y(e.y), text: str(e.text, 200), italic: flag(e.italic), size: e.size === undefined ? 18 : number(e.size, 10, 40) };
      default: return fail('不支持的配图元素');
    }
  });
  return { width, height, description: str(d.description, 800), elements };
}
export function validateWorksheetBlocks(value: unknown): WorksheetBlock[] {
  const result = array(value, 100).map((value: unknown) => {
    const b = obj(value);
    switch (b.kind) {
      case 'paragraph': return { kind: 'paragraph' as const, inlines: array(b.inlines, 200).map(inline), ...(b.keepWithNext === undefined ? {} : { keepWithNext: flag(b.keepWithNext) }) };
      case 'equation': return { kind: 'equation' as const, math: validateWorksheetMath(b.math) };
      case 'figure': { const drawing = validateWorksheetDrawing(b.drawing), widthMm = number(b.widthMm, 20, 165); if (widthMm * drawing.height / drawing.width > 210) fail('单幅配图超过页面高度，请重新安排图的比例或拆分图组'); return { kind: 'figure' as const, drawing, widthMm }; }
      case 'sourcePhoto': {
        if (Object.keys(b).some(key => !['kind', 'crop', 'description', 'widthMm'].includes(key))) fail('照片只能引用当前题目的原件裁剪区域');
        const c = obj(b.crop);
        if (Object.keys(c).some(key => !['x', 'y', 'width', 'height'].includes(key))) fail('照片裁剪区域格式不正确');
        const crop = { x: number(c.x, 0, 1), y: number(c.y, 0, 1), width: number(c.width, Number.EPSILON, 1), height: number(c.height, Number.EPSILON, 1) };
        if (crop.x + crop.width > 1 + 1e-9 || crop.y + crop.height > 1 + 1e-9) fail('照片裁剪区域超出原件边界');
        return { kind: 'sourcePhoto' as const, crop, description: str(b.description, 800), widthMm: number(b.widthMm, 20, 165) };
      }
      case 'table': {
        const rows = array(b.rows, 50).map(row => array(row, 10).map(cell => array(cell, 100).map(inline)));
        if (rows.some(row => row.length !== rows[0].length)) fail('表格列数不一致');
        const columnWidths = b.columnWidths === undefined ? undefined : array(b.columnWidths, 10).map(v => number(v, 1, 100));
        if (columnWidths && columnWidths.length !== rows[0].length) fail('表格列宽与列数不一致');
        return { kind: 'table' as const, rows, ...(columnWidths ? { columnWidths } : {}) };
      }
      default: return fail('不支持的题目排版块');
    }
  });
  if (JSON.stringify(result).length > 150000) fail('单题排版内容过大');
  return result;
}
export function validateWorksheetMaterial(value: unknown): NonNullable<PreparedWorksheetQuestion['sharedMaterial']> {
  const material = obj(value), id = str(material.id, 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail('共用材料编号无效');
  return { id, title: str(material.title, 200), blocks: validateWorksheetBlocks(material.blocks) };
}
