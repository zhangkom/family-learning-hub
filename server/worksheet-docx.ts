import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { sharp } from './sharp';
import type { PreparedWorksheetQuestion, WorksheetBlock, WorksheetDrawing, WorksheetInline, WorksheetMath } from '../lib/worksheet';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xml = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const wrap = (tag: string, value: string) => `<m:${tag}>${value}</m:${tag}>`;

/** Native OMML: all mathematical characters remain editable in Word. */
export function worksheetMathXml(math: WorksheetMath): string {
  const e = worksheetMathXml;
  switch (math.kind) {
    case 'text': {
      // LO drops trailing Latin characters when a single OMML run mixes scripts.
      // Keep existing pure math runs intact; give mixed Han segments their own font.
      const parts = /\p{Script=Han}/u.test(math.text) ? math.text.split(/([\p{Script=Han}\u3000-\u303f\uff00-\uffef]+)/u).filter(Boolean) : [math.text];
      return parts.map(text => {
        const han = parts.length > 1 && /\p{Script=Han}/u.test(text), upright = han || math.upright, font = han ? 'SimSun' : 'Cambria Math';
        return `<m:r><m:rPr>${upright ? '<m:nor/>' : ''}<m:sty m:val="${math.bold ? upright ? 'b' : 'bi' : upright ? 'p' : 'i'}"/></m:rPr><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="SimSun"/><w:i w:val="${upright ? '0' : '1'}"/><w:sz w:val="24"/></w:rPr><m:t xml:space="preserve">${xml(text)}</m:t></m:r>`;
      }).join('');
    }
    case 'row': return math.items.map(e).join('');
    case 'fraction': return wrap('f', wrap('num', e(math.numerator)) + wrap('den', e(math.denominator)));
    case 'script': return wrap(math.sub && math.sup ? 'sSubSup' : math.sub ? 'sSub' : 'sSup', wrap('e', e(math.base)) + (math.sub ? wrap('sub', e(math.sub)) : '') + (math.sup ? wrap('sup', e(math.sup)) : ''));
    // Both sPre slots are required. An empty slot displays a placeholder square in
    // LibreOffice; a native, zero-width math run keeps it blank in Word and LO.
    case 'prescript': return wrap('sPre', wrap('sub', e(math.sub || { kind: 'text', text: '\u200b', upright: true })) + wrap('sup', e(math.sup || { kind: 'text', text: '\u200b', upright: true })) + wrap('e', e(math.base)));
    case 'root': return wrap('rad', `<m:radPr><m:degHide m:val="${math.degree ? '0' : '1'}"/></m:radPr>` + wrap('deg', math.degree ? e(math.degree) : '') + wrap('e', e(math.value)));
    case 'accent': return wrap('acc', `<m:accPr><m:chr m:val="${{ bar: '̅', vector: '⃗', hat: '̂' }[math.mark]}"/></m:accPr>` + wrap('e', e(math.value)));
    case 'bracket': return wrap('d', `<m:dPr><m:begChr m:val="${xml(math.left)}"/><m:endChr m:val="${xml(math.right)}"/></m:dPr>` + wrap('e', e(math.value)));
    case 'matrix': return wrap('m', `<m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${math.rows[0].length}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs></m:mPr>` + math.rows.map(row => wrap('mr', row.map(cell => wrap('e', e(cell))).join(''))).join(''));
  }
}
function run(text: string, properties = '') {
  return `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun"/><w:color w:val="000000"/>${properties}</w:rPr>${text.split('\n').map((line, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${xml(line)}</w:t>`).join('')}</w:r>`;
}
function inline(i: WorksheetInline) {
  return 'math' in i ? wrap('oMath', worksheetMathXml(i.math)) : run(i.text, `${i.italic ? '<w:i/>' : ''}${i.bold ? '<w:b/>' : ''}${i.underline ? `<w:u w:val="${i.underline}"/>` : ''}${i.sub || i.sup ? `<w:vertAlign w:val="${i.sub ? 'subscript' : 'superscript'}"/>` : ''}`);
}
function paragraph(content: string, { keep = true, style = '', before = 0, after = 80, extra = '' } = {}) {
  return `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${keep ? '<w:keepNext/>' : ''}<w:keepLines/><w:widowControl/><w:spacing w:before="${before}" w:after="${after}" w:line="300" w:lineRule="auto"/>${extra}</w:pPr>${content}</w:p>`;
}
const field = (name: string) => `<w:fldSimple w:instr="${name}">${run('1')}</w:fldSimple>`;
const points = (list: [number, number][]) => list.map(point => point.join(',')).join(' ');
export function worksheetDrawingSvg(d: WorksheetDrawing, pixelWidth = d.width) {
  const fill = (value?: string) => value === 'gray' ? '#dedede' : value === 'black' ? '#000' : '#fff';
  const elements = d.elements.map(e => {
    const weight = e.strokeWidth === undefined ? '' : ` stroke-width="${e.strokeWidth}"`;
    switch (e.kind) {
      case 'line': return `<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}"${weight}${e.dashed ? ' stroke-dasharray="5 4"' : ''}${e.arrow ? ' marker-end="url(#arrow)"' : ''}/>`;
      case 'polyline': return `<${e.closed ? 'polygon' : 'polyline'} points="${points(e.points)}" fill="${e.closed ? fill(e.fill) : 'none'}"${weight}${e.dashed ? ' stroke-dasharray="5 4"' : ''}/>`;
      case 'ellipse': return `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" fill="${fill(e.fill)}"${weight}/>`;
      case 'label': return `<text x="${e.x}" y="${e.y}" fill="#000" stroke="none" font-family="Times New Roman, Noto Serif CJK SC, SimSun, serif" font-size="${e.size || 18}"${e.italic ? ' font-style="italic"' : ''}>${xml(e.text)}</text>`;
    }
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${Math.ceil(pixelWidth * d.height / d.width)}" viewBox="0 0 ${d.width} ${d.height}"><title>${xml(d.description)}</title><rect width="100%" height="100%" fill="white"/><defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="black" stroke="none"/></marker></defs><g fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${elements}</g></svg>`;
}

const crcTable = Array.from({ length: 256 }, (_, v) => { for (let i = 0; i < 8; i++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1; return v >>> 0; });
function crc32(bytes: Buffer) { let v = 0xffffffff; for (const b of bytes) v = crcTable[(v ^ b) & 255] ^ (v >>> 8); return (v ^ 0xffffffff) >>> 0; }
/** Small deterministic OPC ZIP writer; fixed internal paths only, never client-supplied archive names. */
export function worksheetZip(files: Map<string, Buffer>): Buffer {
  let offset = 0;
  const local: Buffer[] = [], central: Buffer[] = [];
  for (const [path, bytes] of files) {
    const name = Buffer.from(path), compressed = deflateRawSync(bytes), crc = crc32(bytes), head = Buffer.alloc(30), directory = Buffer.alloc(46);
    head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x800, 6); head.writeUInt16LE(8, 8); head.writeUInt16LE(33, 12);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(compressed.length, 18); head.writeUInt32LE(bytes.length, 22); head.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10); directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(head, name, compressed); central.push(directory, name); offset += head.length + name.length + compressed.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
const photoOptions = { limitInputPixels: 32000000, failOn: 'error' as const };
export type WorksheetSourceImage = { bytes: Buffer; sha256: string; width: number; height: number };
export async function worksheetSourceImage(bytes: Buffer, expectedSha256?: string): Promise<WorksheetSourceImage> {
  if (!bytes.length || bytes.length > 32 * 1024 * 1024) throw new Error('照片原件为空或超过读取大小');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (expectedSha256 !== undefined && (!/^[a-f0-9]{64}$/.test(expectedSha256) || sha256 !== expectedSha256)) throw new Error('照片原件版本校验失败，请重新核对');
  const meta = await sharp(bytes, photoOptions).metadata();
  if (!['jpeg', 'png', 'webp', 'heif', 'tiff'].includes(meta.format || '') || !meta.width || !meta.height || meta.width * meta.height > 32000000 || (meta.pages || 1) !== 1) throw new Error('照片原件格式或尺寸无效');
  // A readable header alone is insufficient: truncated files must not be marked ready to print.
  await sharp(bytes, photoOptions).resize({ width: 1, height: 1, fit: 'inside', withoutEnlargement: true }).raw().toBuffer();
  const rotated = (meta.orientation || 1) >= 5;
  return { bytes, sha256, width: rotated ? meta.height : meta.width, height: rotated ? meta.width : meta.height };
}
export type WorksheetDocumentQuestion = { sourceTitle: string; originalNumber: string; subject: string; stars: number; prepared: PreparedWorksheetQuestion; sourceImage?: WorksheetSourceImage };
export function worksheetHasSourcePhotos(prepared: PreparedWorksheetQuestion, includeAnswers = true) {
  return [...(prepared.sharedMaterial?.blocks || []), ...prepared.blocks, ...(includeAnswers ? prepared.answerBlocks || [] : [])].some(b => b.kind === 'sourcePhoto');
}
function photoLayout(b: Extract<WorksheetBlock, { kind: 'sourcePhoto' }>, image?: WorksheetSourceImage) {
  if (!image) throw new Error('题目照片原件不可用，请恢复原件后再导出');
  const c = b.crop;
  if (![c.x, c.y, c.width, c.height, b.widthMm].every(Number.isFinite) || c.x < 0 || c.y < 0 || c.width <= 0 || c.height <= 0 || c.x + c.width > 1 + 1e-9 || c.y + c.height > 1 + 1e-9 || b.widthMm < 20 || b.widthMm > 165) throw new Error('照片裁剪区域或打印尺寸无效');
  // Ignore floating-point noise at exact pixel boundaries (e.g. .2 + .4).
  const left = Math.floor(c.x * image.width + 1e-7), top = Math.floor(c.y * image.height + 1e-7);
  const width = Math.min(image.width, Math.ceil((c.x + c.width) * image.width - 1e-7)) - left;
  const height = Math.min(image.height, Math.ceil((c.y + c.height) * image.height - 1e-7)) - top;
  if (width < 8 || height < 8) throw new Error('照片裁剪区域过小，请核对原件');
  const heightMm = b.widthMm * height / width;
  if (heightMm > 210) throw new Error('照片超过一页的打印高度，请调整裁剪或打印宽度');
  const outputWidth = Math.min(width, Math.ceil(b.widthMm / 25.4 * 400));
  return { box: { left, top, width, height }, heightMm, outputWidth, outputHeight: Math.max(1, Math.round(outputWidth * height / width)) };
}
export function worksheetDocumentBudget(questions: WorksheetDocumentQuestion[], includeAnswers: boolean, allowUnloadedPhotos = false) {
  let pixels = 0, figures = 0, characters = 0;
  const materials = new Map<string, string>();
  const sourceImages = new Set<Buffer>(); let sourceBytes = 0;
  for (const q of questions) {
    characters += JSON.stringify(q.prepared).length;
    if (q.sourceImage && !sourceImages.has(q.sourceImage.bytes)) { sourceImages.add(q.sourceImage.bytes); sourceBytes += q.sourceImage.bytes.length; }
    const material = q.prepared.sharedMaterial, materialText = material ? JSON.stringify([material, material.blocks.some(b => b.kind === 'sourcePhoto') ? q.sourceImage?.sha256 : undefined]) : '';
    if (material && materials.has(material.id) && materials.get(material.id) !== materialText) throw new Error('同一份共用材料存在不同版本，请先统一核对');
    const materialBlocks = material && !materials.has(material.id) ? material.blocks : [];
    if (material) materials.set(material.id, materialText);
    for (const b of [...materialBlocks, ...q.prepared.blocks, ...(includeAnswers ? q.prepared.answerBlocks || [] : [])]) if (b.kind === 'figure') {
      const width = Math.ceil(b.widthMm / 25.4 * 600), height = Math.ceil(width * b.drawing.height / b.drawing.width);
      if (b.widthMm > 165 || b.widthMm * b.drawing.height / b.drawing.width > 210 || width * height > 32000000) throw new Error('配图超过一页的打印尺寸，请调整图组排版');
      pixels += width * height; figures++;
    } else if (b.kind === 'sourcePhoto') {
      figures++;
      if (allowUnloadedPhotos && !q.sourceImage) continue;
      const photo = photoLayout(b, q.sourceImage);
      pixels += photo.outputWidth * photo.outputHeight;
    }
  }
  if (pixels > 600000000 || figures > 300 || characters > 12000000 || sourceBytes > 128 * 1024 * 1024) throw new Error('本次文档配图或内容较多，请按科目分次导出，未省略任何题目');
}
export async function buildWorksheetDocx(input: { studentName: string; questions: WorksheetDocumentQuestion[]; includeAnswers: boolean; date: string; signal?: AbortSignal }) {
  input = { ...input, questions: input.questions.map(q => ({ ...q })) };
  worksheetDocumentBudget(input.questions, input.includeAnswers, true);
  // The public writer also verifies supplied bytes, rather than trusting dimensions or a caller's hash.
  const checked = new Map<Buffer, WorksheetSourceImage>();
  for (const q of input.questions) if (worksheetHasSourcePhotos(q.prepared, input.includeAnswers)) {
    input.signal?.throwIfAborted();
    if (!q.sourceImage) throw new Error('题目照片原件不可用，请恢复原件后再导出');
    const original = q.sourceImage;
    let image = checked.get(original.bytes);
    if (!image) { image = await worksheetSourceImage(original.bytes, original.sha256); checked.set(original.bytes, image); }
    if (image.sha256 !== original.sha256) throw new Error('照片原件版本校验失败，请重新核对');
    q.sourceImage = image;
  }
  worksheetDocumentBudget(input.questions, input.includeAnswers);
  const files = new Map<string, Buffer>(), relationships: string[] = [];
  const addXml = (path: string, content: string) => files.set(path, Buffer.from(declaration + content));
  let imageId = 0;
  async function block(b: WorksheetBlock, q: WorksheetDocumentQuestion, keep = true) {
    input.signal?.throwIfAborted();
    if (b.kind === 'paragraph') return paragraph(b.inlines.map(inline).join(''), { keep: keep || b.keepWithNext === true });
    if (b.kind === 'equation') return paragraph(`<m:oMathPara><m:oMathParaPr><m:jc m:val="centerGroup"/></m:oMathParaPr>${wrap('oMath', worksheetMathXml(b.math))}</m:oMathPara>`, { keep });
    if (b.kind === 'table') {
      const weights = b.columnWidths || b.rows[0].map(() => 1), total = weights.reduce((sum, value) => sum + value, 0);
      const widths = weights.map(value => Math.floor(9350 * value / total));
      widths[widths.length - 1] += 9350 - widths.reduce((sum, value) => sum + value, 0);
      const border = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(name => `<w:${name} w:val="single" w:sz="4" w:color="D9D9D9"/>`).join('');
      return `<w:tbl><w:tblPr><w:tblW w:w="9350" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(width => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${b.rows.map((row, index) => `<w:tr><w:trPr><w:cantSplit/>${index === 0 ? '<w:tblHeader/>' : ''}</w:trPr>${row.map((cell, column) => `<w:tc><w:tcPr><w:tcW w:w="${widths[column]}" w:type="dxa"/><w:vAlign w:val="center"/>${index === 0 ? '<w:shd w:fill="F0F0F0"/>' : ''}</w:tcPr>${paragraph(cell.map(inline).join(''), { after: 20 })}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
    }
    const id = ++imageId, widthEmu = Math.round(b.widthMm * 36000);
    let heightEmu: number, description: string, png: Buffer;
    if (b.kind === 'sourcePhoto') {
      const photo = photoLayout(b, q.sourceImage);
      heightEmu = Math.round(photo.heightMm * 36000); description = b.description;
      // Preserve the actual photograph; only crop and reduce to at most 400 dpi, never invent pixels.
      png = await sharp(q.sourceImage!.bytes, photoOptions).rotate().extract(photo.box).resize({ width: photo.outputWidth, withoutEnlargement: true }).png().toBuffer();
    } else {
      heightEmu = Math.round(widthEmu * b.drawing.height / b.drawing.width); description = b.drawing.description;
      const widthPx = Math.ceil(b.widthMm / 25.4 * 600);
      png = await sharp(Buffer.from(worksheetDrawingSvg(b.drawing, widthPx)), { density: 72, limitInputPixels: 32000000 }).png().toBuffer();
    }
    files.set(`word/media/figure${id}.png`, png);
    relationships.push(`<Relationship Id="figure${id}" Type="${R}/image" Target="media/figure${id}.png"/>`);
    return paragraph(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${widthEmu}" cy="${heightEmu}"/><wp:docPr id="${id}" name="原题配图 ${id}" descr="${xml(description)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="figure${id}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="figure${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, { keep, extra: '<w:jc w:val="center"/>' });
  }
  let body = paragraph(run(`${input.studentName} 错题练习卷`), { style: 'Title', after: 140 }) + paragraph(run(`姓名：____________    日期：____________    共 ${input.questions.length} 题`, '<w:sz w:val="21"/>'), { keep: false, after: 240 });
  let lastSubject = '';
  const materialBookmarks = new Map<string, number>();
  for (const [index, q] of input.questions.entries()) {
    input.signal?.throwIfAborted();
    if (q.subject !== lastSubject) { body += paragraph(run(q.subject), { style: 'Heading1', before: 120, after: 180 }); lastSubject = q.subject; }
    const material = q.prepared.sharedMaterial;
    if (material && !materialBookmarks.has(material.id)) {
      const bookmark = materialBookmarks.size + 1; materialBookmarks.set(material.id, bookmark);
      body += paragraph(`<w:bookmarkStart w:id="${bookmark}" w:name="material_${bookmark}"/>${run(`共用材料 ${bookmark}  ${material.title}`, '<w:b/>')}<w:bookmarkEnd w:id="${bookmark}"/>`, { before: 100 });
      for (const b of material.blocks) body += await block(b, q, false);
      body += paragraph('', { keep: false, after: 100 });
    }
    body += paragraph(run(`${index + 1}. 来源：${q.sourceTitle}  原题号：${q.originalNumber}`, '<w:b/><w:sz w:val="21"/>'), { before: 100, after: 70 });
    if (material) { const bookmark = materialBookmarks.get(material.id)!; body += paragraph(run(`共用材料 ${bookmark}：${material.title}（第 `, '<w:sz w:val="21"/>') + field(`PAGEREF material_${bookmark}`) + run(' 页）', '<w:sz w:val="21"/>'), { after: 60 }); }
    body += paragraph(run(`难度 ${'★'.repeat(q.stars)}${'☆'.repeat(5 - q.stars)}`, '<w:sz w:val="19"/>'), { after: 100 });
    for (const b of q.prepared.blocks) body += await block(b, q);
    // KeepNext links the complete question and its answer area. Its last paragraph
    // ends the chain so Word moves a question that will not fit to the next page.
    const answerTwips = Math.max(180, Math.round(q.prepared.answerSpaceMm / 25.4 * 1440));
    body += `<w:p><w:pPr><w:keepLines/><w:spacing w:before="${answerTwips}" w:after="180" w:line="60" w:lineRule="exact"/></w:pPr>${run(' ', '<w:sz w:val="2"/>')}</w:p>`;
  }
  if (input.includeAnswers) {
    body += paragraph(run('参考答案与解析'), { style: 'Heading1', extra: '<w:pageBreakBefore/>', after: 180 });
    for (const [index, q] of input.questions.entries()) {
      body += paragraph(run(`${index + 1}. ${q.sourceTitle}  原题号：${q.originalNumber}`, '<w:b/>'));
      for (const b of q.prepared.answerBlocks!) body += await block(b, q);
      body += paragraph('', { keep: false, after: 180 });
    }
  }
  body += '<w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1247" w:header="510" w:footer="510"/><w:cols w:space="720"/></w:sectPr>';
  const namespaces = `xmlns:w="${W}" xmlns:m="${M}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;
  addXml('word/document.xml', `<w:document ${namespaces}><w:body>${body}</w:body></w:document>`);
  addXml('word/header1.xml', `<w:hdr xmlns:w="${W}">${paragraph(run(`知识棱镜AI    ${input.studentName} 错题练习`, '<w:sz w:val="18"/>'), { keep: false, after: 0 })}</w:hdr>`);
  addXml('word/footer1.xml', `<w:ftr xmlns:w="${W}">${paragraph(run('第 ', '<w:sz w:val="18"/>') + field('PAGE') + run(' 页 / 共 ', '<w:sz w:val="18"/>') + field('NUMPAGES') + run(' 页', '<w:sz w:val="18"/>'), { keep: false, after: 0, extra: '<w:jc w:val="center"/>' })}</w:ftr>`);
  addXml('word/styles.xml', `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun"/><w:sz w:val="24"/><w:color w:val="000000"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="34"/><w:color w:val="000000"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="000000"/></w:rPr></w:style></w:styles>`);
  addXml('word/settings.xml', `<w:settings xmlns:w="${W}" xmlns:m="${M}"><w:updateFields w:val="true"/><m:mathPr><m:mathFont m:val="Cambria Math"/></m:mathPr><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`);
  addXml('word/_rels/document.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="${R}/styles" Target="styles.xml"/><Relationship Id="settings" Type="${R}/settings" Target="settings.xml"/><Relationship Id="header" Type="${R}/header" Target="header1.xml"/><Relationship Id="footer" Type="${R}/footer" Target="footer1.xml"/>${relationships.join('')}</Relationships>`);
  addXml('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
  addXml('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${[['document', 'document.main'], ['styles', 'styles'], ['settings', 'settings']].map(([name, type]) => `<Override PartName="/word/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`).join('')}<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`);
  if (Array.from(files.values()).reduce((sum, item) => sum + item.length, 0) > 64 * 1024 * 1024) throw new Error('文档超过可导出大小，请按科目分次导出');
  input.signal?.throwIfAborted();
  return worksheetZip(files);
}
