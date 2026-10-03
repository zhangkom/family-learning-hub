import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { sharp } from './sharp';
import { buildWorksheetDocx, worksheetDocumentBudget, worksheetDrawingSvg, worksheetMathXml, worksheetSourceImage, type WorksheetDocumentQuestion } from './worksheet-docx';
import { validateWorksheetBlocks, validateWorksheetMath, type WorksheetMath } from '../lib/worksheet';

// Read central directory offsets as an ordinary ZIP consumer, rather than using the writer.
function unpack(input: Uint8Array) {
  const bytes = Buffer.from(input);
  const eocd = bytes.length - 22, count = bytes.readUInt16LE(eocd + 10), files = new Map<string, Buffer>();
  expect(bytes.readUInt32LE(eocd)).toBe(0x06054b50);
  let cursor = bytes.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    expect(bytes.readUInt32LE(cursor)).toBe(0x02014b50);
    const size = bytes.readUInt32LE(cursor + 20), nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString(), local = bytes.readUInt32LE(cursor + 42);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    files.set(name, inflateRawSync(bytes.subarray(start, start + size))); cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
const t = (text: string, upright = false): WorksheetMath => ({ kind: 'text', text, upright });
function fixture(): WorksheetDocumentQuestion {
  return { sourceTitle: '物理单元练习（合成测试）', originalNumber: '13（2）', subject: '物理', stars: 3,
    prepared: { version: 1, sourceFingerprint: 'a'.repeat(64), reviewedAt: '2026-10-03', reviewedBy: 'test', verificationNote: '合成题，完整文本和几何构型已明确', answerSpaceMm: 30,
      blocks: [
        { kind: 'paragraph', inlines: [{ text: '小球从 A 点水平抛出，初速度为 ' }, { math: { kind: 'script', base: t('v'), sub: t('0', true) } }, { text: '，下落高度为 ' }, { math: t('h') }, { text: '。不计空气阻力，求水平位移。' }] },
        { kind: 'equation', math: { kind: 'row', items: [t('h'), t('=', true), { kind: 'fraction', numerator: t('1', true), denominator: t('2', true) }, t('g'), { kind: 'script', base: t('t'), sup: t('2', true) }] } },
        { kind: 'figure', widthMm: 70, drawing: { width: 280, height: 160, description: 'A点水平抛出的小球及水平地面', elements: [
          { kind: 'line', x1: 20, y1: 140, x2: 260, y2: 140 }, { kind: 'line', x1: 45, y1: 40, x2: 105, y2: 40, arrow: true },
          { kind: 'ellipse', cx: 45, cy: 40, rx: 4, ry: 4, fill: 'black' }, { kind: 'label', x: 28, y: 28, text: 'A', italic: true },
          { kind: 'line', x1: 45, y1: 45, x2: 45, y2: 135, dashed: true }, { kind: 'label', x: 26, y: 96, text: 'h', italic: true },
        ] } },
      ], answerBlocks: [{ kind: 'paragraph', inlines: [{ text: '这是可选答案，不能泄漏到题目卷。' }] }],
    } };
}
describe('worksheet editable math and print document', () => {
  it('writes editable fraction, superscript, root, accent, matrix and upright chemical symbols', () => {
    const math = validateWorksheetMath({ kind: 'row', items: [
      { kind: 'fraction', numerator: t('x'), denominator: t('2', true) },
      { kind: 'script', base: t('SO', true), sub: t('4', true), sup: t('2−', true) },
      { kind: 'root', value: t('x'), degree: t('3', true) },
      { kind: 'accent', value: t('F'), mark: 'vector' },
      { kind: 'bracket', left: '[', right: ']', value: { kind: 'matrix', rows: [[t('1', true), t('2', true)]] } },
    ] });
    const xml = worksheetMathXml(math);
    for (const tag of ['m:f', 'm:sSubSup', 'm:rad', 'm:acc', 'm:d', 'm:m']) expect(xml).toContain(`<${tag}>`);
    expect(xml).toContain('<m:sty m:val="p"/>'); expect(xml).not.toContain('<w:drawing');
    expect(xml).toContain('w:eastAsia="SimSun"');
  });
  it('preserves mixed Han and Latin math as separate editable font runs', () => {
    const mixed = worksheetMathXml(t('温度20 ℃时x = 1', true));
    const segments = [...mixed.matchAll(/<m:t xml:space="preserve">(.*?)<\/m:t>/g)].map(m => m[1]);
    expect(segments).toEqual(['温度', '20 ℃', '时', 'x = 1']);
    expect(segments.join('')).toBe('温度20 ℃时x = 1');
    expect(mixed).toContain('w:ascii="SimSun" w:hAnsi="SimSun"');
    expect(mixed).toContain('w:ascii="Cambria Math" w:hAnsi="Cambria Math"');
    expect(mixed).not.toContain('<w:drawing');
    expect(worksheetMathXml(t(' = 10 ', true)).match(/<m:r>/g)).toHaveLength(1);
    expect(worksheetMathXml(t('月', true)).match(/<m:r>/g)).toHaveLength(1);
  });
  it('contains provenance, stars, page fields, editable math and 600-dpi figures but no answer unless selected', async () => {
    const bytes = await buildWorksheetDocx({ studentName: '测试学生', questions: [fixture(), fixture()], date: '2026-10-03', includeAnswers: false });
    const files = unpack(bytes), document = files.get('word/document.xml')!.toString();
    expect(document).toContain('原题号：13（2）'); expect(document).toContain('难度 ★★★☆☆'); expect(document).toContain('<m:oMath>');
    expect(document).toContain('<w:keepNext/>'); expect(document).toContain('<w:keepLines/>'); expect(document).not.toContain('可选答案');
    expect(document).toContain('w:line="300" w:lineRule="auto"');
    expect(files.get('word/footer1.xml')!.toString()).toContain('NUMPAGES'); expect(files.get('word/header1.xml')!.toString()).toContain('知识棱镜AI');
    const png = await sharp(files.get('word/media/figure1.png')!).metadata();
    expect(png.width).toBe(Math.ceil(70 / 25.4 * 600)); expect(png.height).toBeGreaterThan(900);
    expect(files.get('word/_rels/document.xml.rels')!.toString()).not.toContain('TargetMode="External"');
    const withAnswer = unpack(await buildWorksheetDocx({ studentName: '测试学生', questions: [fixture()], date: '2026-10-03', includeAnswers: true }));
    expect(withAnswer.get('word/document.xml')!.toString()).toContain('可选答案');
  });
  it('rejects giant figures and cumulative resource requests before rendering', () => {
    expect(() => validateWorksheetBlocks([{ kind: 'figure', widthMm: 165, drawing: { width: 50, height: 2000, description: 'bad', elements: [{ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10 }] } }])).toThrow('高度');
    const q = fixture(); q.prepared.blocks = Array.from({ length: 301 }, () => q.prepared.blocks[2]);
    expect(() => worksheetDocumentBudget([q], false)).toThrow('分次');
    expect(() => validateWorksheetMath({ kind: 'script', base: t('x') })).toThrow('上下标');
  });
  it('keeps reviewed table column proportions within the page width', async () => {
    const q = fixture(), rows = [[[{ text: '组别' }], [{ text: '处理方法' }], [{ text: '数据一' }], [{ text: '数据二' }]]];
    q.prepared.blocks = validateWorksheetBlocks([{ kind: 'table', rows, columnWidths: [15, 45, 20, 20] }]);
    const doc = unpack(await buildWorksheetDocx({ studentName: '测试', questions: [q], includeAnswers: false, date: '' })).get('word/document.xml')!.toString();
    expect(doc).toContain('<w:gridCol w:w="1402"/><w:gridCol w:w="4207"/><w:gridCol w:w="1870"/><w:gridCol w:w="1871"/>');
    for (const columnWidths of [[15, 45], [0, 45, 20, 20], [15, Infinity, 20, 20]]) expect(() => validateWorksheetBlocks([{ kind: 'table', rows, columnWidths }])).toThrow();
  });
  it('escapes text in XML/diagram labels and honors cancellation', async () => {
    const q = fixture(); q.sourceTitle = '<wrong & "source">';
    const d = q.prepared.blocks[2]; if (d.kind !== 'figure') throw new Error('fixture');
    d.drawing.elements.push({ kind: 'label', x: 10, y: 20, text: '<script>alert(1)</script>' });
    expect(worksheetDrawingSvg(d.drawing)).toContain('&lt;script&gt;');
    const controller = new AbortController(); controller.abort();
    await expect(buildWorksheetDocx({ studentName: '测试', questions: [q], date: '2026-10-03', includeAnswers: false, signal: controller.signal })).rejects.toThrow();
  });
  it('prints shared material once with page references and native prescripts, underlines and line weights', async () => {
    const q = fixture();
    q.prepared.blocks = validateWorksheetBlocks([
      { kind: 'paragraph', inlines: [{ text: '直线', underline: 'single' }, { text: '波浪线', underline: 'wave' }] },
      { kind: 'equation', math: { kind: 'prescript', base: t('Na', true), sub: t('11', true), sup: t('23', true) } },
    ]);
    q.prepared.sharedMaterial = { id: 'shared', title: '合成共用材料', blocks: validateWorksheetBlocks([{ kind: 'paragraph', keepWithNext: true, inlines: [{ text: '材料二：' }] }, { kind: 'paragraph', inlines: [{ text: 'MATERIAL_ONCE' }] }]) };
    const files = unpack(await buildWorksheetDocx({ studentName: '测试', questions: [q, q], includeAnswers: false, date: '' }));
    const doc = files.get('word/document.xml')!.toString();
    expect(doc.match(/MATERIAL_ONCE/g)).toHaveLength(1); expect(doc.match(/PAGEREF material_1/g)).toHaveLength(2);
    const heading = doc.split('</w:p>').find(p => p.includes('材料二：'))!; expect(heading).toContain('<w:keepNext/>');
    const passage = doc.split('</w:p>').find(p => p.includes('MATERIAL_ONCE'))!; expect(passage).not.toContain('<w:keepNext/>');
    expect(() => validateWorksheetBlocks([{ kind: 'paragraph', inlines: [{ text: '标题' }], keepWithNext: 'true' }])).toThrow('样式');
    expect(doc).toContain('<m:sPre><m:sub>'); expect(doc).toContain('<w:u w:val="single"/>'); expect(doc).toContain('<w:u w:val="wave"/>');
    const drawing = fixture().prepared.blocks[2]; if (drawing.kind !== 'figure') throw new Error('fixture');
    drawing.drawing.elements[0].strokeWidth = 0.6;
    expect(worksheetDrawingSvg(drawing.drawing)).toContain('stroke-width="0.6"');
    expect(() => validateWorksheetMath({ kind: 'prescript', base: t('C', true) })).toThrow('上下标');
    for (const m of [{ kind: 'prescript' as const, base: t('O', true), sup: t('18', true) }, { kind: 'prescript' as const, base: t('P', true), sub: t('15', true) }]) {
      const formula = worksheetMathXml(m); expect(formula).toContain('\u200b'); expect(formula).not.toContain('<m:sub></m:sub>'); expect(formula).not.toContain('<m:sup></m:sup>'); expect(formula).not.toContain('<w:drawing');
    }
    expect(() => validateWorksheetBlocks([{ ...drawing, drawing: { ...drawing.drawing, elements: [{ ...drawing.drawing.elements[0], strokeWidth: 0 }] } }])).toThrow('范围');
    const changed = structuredClone(q); changed.prepared.sharedMaterial!.blocks = [{ kind: 'paragraph', inlines: [{ text: 'Different source text' }] }];
    expect(() => worksheetDocumentBudget([q, changed], false)).toThrow('不同版本');
  });
  it('embeds exact source photograph crop pixels without upscaling or leaking neighbouring regions', async () => {
    const raw = Buffer.alloc(120 * 80 * 3);
    for (let y = 0; y < 80; y++) for (let x = 0; x < 120; x++) { const i = (y * 120 + x) * 3; raw[i] = x; raw[i + 1] = y; raw[i + 2] = (x + y) % 256; }
    const bytes = await sharp(raw, { raw: { width: 120, height: 80, channels: 3 } }).png().toBuffer();
    const q = fixture(); q.sourceImage = await worksheetSourceImage(bytes);
    q.prepared.blocks = validateWorksheetBlocks([{ kind: 'sourcePhoto', crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, widthMm: 70, description: '合成实验照片，无手写内容' }]);
    const files = unpack(await buildWorksheetDocx({ studentName: '测试', questions: [q], includeAnswers: false, date: '' }));
    const png = files.get('word/media/figure1.png')!, meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([60, 40]);
    const expected = await sharp(bytes).extract({ left: 30, top: 20, width: 60, height: 40 }).raw().toBuffer();
    expect(await sharp(png).raw().toBuffer()).toEqual(expected);
    expect(files.get('word/document.xml')!.toString()).toContain('cx="2520000" cy="1680000"');
    expect(files.get('word/_rels/document.xml.rels')!.toString()).not.toContain('External');
  });
  it('caps photograph resolution at 400 dpi, validates actual source bytes and respects EXIF orientation', async () => {
    const bytes = await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#abc' } }).png().toBuffer();
    const q = fixture(); q.sourceImage = await worksheetSourceImage(bytes);
    q.prepared.blocks = validateWorksheetBlocks([{ kind: 'sourcePhoto', crop: { x: 0, y: 0, width: 1, height: 1 }, widthMm: 50.8, description: '合成照片' }]);
    const files = unpack(await buildWorksheetDocx({ studentName: '测试', questions: [q], includeAnswers: false, date: '' }));
    expect((await sharp(files.get('word/media/figure1.png')!).metadata()).width).toBe(800);
    const oriented = await sharp({ create: { width: 80, height: 120, channels: 3, background: '#abc' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    q.sourceImage = await worksheetSourceImage(oriented); expect([q.sourceImage.width, q.sourceImage.height]).toEqual([120, 80]);
    const rotated = unpack(await buildWorksheetDocx({ studentName: '测试', questions: [q], includeAnswers: false, date: '' }));
    const size = await sharp(rotated.get('word/media/figure1.png')!).metadata(); expect([size.width, size.height]).toEqual([120, 80]);
    q.sourceImage.sha256 = '0'.repeat(64);
    await expect(buildWorksheetDocx({ studentName: '测试', questions: [q], includeAnswers: false, date: '' })).rejects.toThrow('版本');
    await expect(worksheetSourceImage(Buffer.from('not-an-image'))).rejects.toThrow();
    await expect(worksheetSourceImage(bytes.subarray(0, Math.floor(bytes.length / 2)))).rejects.toThrow();
    await expect(worksheetSourceImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>'))).rejects.toThrow('格式');
  });
  it('rejects foreign photo inputs, invalid crops, missing source images, oversized printing and mismatched shared photo sources', async () => {
    const block = { kind: 'sourcePhoto', crop: { x: 0, y: 0, width: 1, height: 1 }, widthMm: 70, description: '照片' };
    for (const extra of [{ url: 'https://example.invalid/private.jpg' }, { path: '/private.jpg' }, { base64: 'abc' }, { scanId: 'other' }]) expect(() => validateWorksheetBlocks([{ ...block, ...extra }])).toThrow('当前题目');
    for (const crop of [{ x: -0.1, y: 0, width: 1, height: 1 }, { x: 0.1, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 0, height: 1 }]) expect(() => validateWorksheetBlocks([{ ...block, crop }])).toThrow();
    const q = fixture(); q.prepared.blocks = validateWorksheetBlocks([block]);
    expect(() => worksheetDocumentBudget([q], false)).toThrow('原件不可用');
    const image = await sharp({ create: { width: 80, height: 400, channels: 3, background: '#fff' } }).png().toBuffer();
    q.sourceImage = await worksheetSourceImage(image); expect(() => worksheetDocumentBudget([q], false)).toThrow('高度');
    const photo = validateWorksheetBlocks([{ ...block, crop: { x: 0, y: 0, width: 1, height: 0.2 } }]);
    q.prepared.blocks = [{ kind: 'paragraph', inlines: [{ text: '问题' }] }]; q.prepared.sharedMaterial = { id: 'photo', title: '共用照片', blocks: photo };
    const other = { ...q, sourceImage: await worksheetSourceImage(await sharp(image).negate().png().toBuffer()) };
    expect(() => worksheetDocumentBudget([q, other], false)).toThrow('不同版本');
    const doc = unpack(await buildWorksheetDocx({ studentName: '测试', questions: [q, q], includeAnswers: false, date: '' }));
    expect([...doc.keys()].filter(k => k.startsWith('word/media/'))).toHaveLength(1);
  });
});
