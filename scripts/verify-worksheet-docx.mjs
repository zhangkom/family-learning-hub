// Synthetic worksheet for independent DOCX readers and visual pagination QA.
import { build } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const output = resolve('work/qa-comprehensive-20261003/word');
await mkdir(output, { recursive: true });
await build({ configFile: false, build: { ssr: resolve('server/worksheet-docx.ts'), outDir: output, emptyOutDir: false, rolldownOptions: { output: { entryFileNames: 'worksheet-docx.mjs' } } } });
const { buildWorksheetDocx } = await import(pathToFileURL(resolve(output, 'worksheet-docx.mjs')).href);
const text = (text, upright = false) => ({ kind: 'text', text, upright });
const paragraph = (text) => ({ kind: 'paragraph', inlines: [{ text }] });
const rows = [
  { sourceTitle: '数学函数单元练习 合成验证', originalNumber: '7', subject: '数学', stars: 3, blocks: [paragraph('已知函数如下，求其定义域，并写出解题过程。'),
    { kind: 'equation', math: { kind: 'row', items: [text('f(x)'), text('=', true), { kind: 'fraction', numerator: { kind: 'root', value: { kind: 'row', items: [text('x'), text('−1', true)] } }, denominator: { kind: 'row', items: [text('x'), text('−2', true)] } }] } }], answerSpaceMm: 45 },
  { sourceTitle: '物理平抛运动练习 合成验证', originalNumber: '13（2）', subject: '物理', stars: 4, blocks: [
    { kind: 'paragraph', inlines: [{ text: '小球从 A 点以初速度 ' }, { math: { kind: 'script', base: text('v'), sub: text('0', true) } }, { text: ' 水平抛出，下落高度为 ' }, { math: text('h') }, { text: '。忽略空气阻力，重力加速度为 ' }, { math: text('g') }, { text: '。求水平位移。' }] },
    { kind: 'figure', widthMm: 82, drawing: { width: 320, height: 170, description: '水平抛出示意图，初速度水平向右，高度h为竖直距离', elements: [
      { kind: 'line', x1: 30, y1: 150, x2: 300, y2: 150 }, { kind: 'ellipse', cx: 50, cy: 40, rx: 4, ry: 4, fill: 'black' },
      { kind: 'line', x1: 56, y1: 40, x2: 132, y2: 40, arrow: true }, { kind: 'line', x1: 50, y1: 50, x2: 50, y2: 143, dashed: true },
      { kind: 'label', x: 32, y: 25, text: 'A', italic: true }, { kind: 'label', x: 96, y: 28, text: 'v₀', italic: true }, { kind: 'label', x: 30, y: 105, text: 'h', italic: true },
      { kind: 'polyline', points: [[50,40],[80,42],[110,49],[140,60],[170,75],[200,95],[230,120],[260,150]], dashed: true },
    ] } },
  ], answerSpaceMm: 35 },
  { sourceTitle: '化学物质性质练习 合成验证', originalNumber: '2', subject: '化学', stars: 3, blocks: [paragraph('某兴趣小组研究稀硫酸与氢氧化钠溶液的反应，实验记录如下。完成反应方程式，并判断中和反应的本质。'),
    { kind: 'table', rows: [[[{ text: '实验' }], [{ text: '观察与操作' }]], [[{ text: '甲' }], [{ text: '滴加酚酞溶液后逐滴加入稀硫酸' }]], [[{ text: '乙' }], [{ text: '记录混合溶液的温度变化' }]]] },
    { kind: 'equation', math: { kind: 'row', items: [{ kind: 'script', base: text('H', true), sub: text('2', true) }, { kind: 'script', base: text('SO', true), sub: text('4', true) }, text(' + 2NaOH → ', true), { kind: 'script', base: text('Na', true), sub: text('2', true) }, { kind: 'script', base: text('SO', true), sub: text('4', true) }, text(' + 2', true), { kind: 'script', base: text('H', true), sub: text('2', true) }, text('O', true)] } },
  ], answerSpaceMm: 35 },
  { sourceTitle: '生物细胞分裂练习 合成验证', originalNumber: '19（1）', subject: '生物', stars: 5, blocks: [paragraph('请比较有丝分裂与减数分裂，说明同源染色体行为的主要区别，并举出判断细胞分裂时期时需要观察的依据。')], answerSpaceMm: 60 },
];
const questions = rows.map(q => ({ ...q, prepared: { version: 1, sourceFingerprint: '0'.repeat(64), blocks: q.blocks, answerSpaceMm: q.answerSpaceMm,
  reviewedAt: new Date().toISOString(), reviewedBy: 'synthetic-verifier', verificationNote: '用于原生公式与排版合成验证', answerBlocks: [paragraph('可选答案附录合成验证文字。')] } }));
await writeFile(resolve(output, 'worksheet-synthetic.docx'), await buildWorksheetDocx({ studentName: '测试学生', questions, includeAnswers: false, date: new Date().toISOString() }));
await writeFile(resolve(output, 'worksheet-synthetic-with-answers.docx'), await buildWorksheetDocx({ studentName: '测试学生', questions, includeAnswers: true, date: new Date().toISOString() }));
console.log(JSON.stringify({ synthetic: true, documents: 2, questions: questions.length, output }));
