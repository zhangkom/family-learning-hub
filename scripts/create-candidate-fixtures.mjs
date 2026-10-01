import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const artifacts = resolve('work/candidate-lab/artifacts');
await mkdir(artifacts, { recursive: true });
// Artificial strokes only. These are geometry fixtures, not an OCR benchmark.
function textLine(x, y, width) {
  let s = '';
  for (let a = 0; a < width; a += 17)
    s += `<path d="M${x + a} ${y}v14h10v-14h-10m0 7h10" fill="none" stroke="#222" stroke-width="2"/>`;
  return s;
}
function question(
  x,
  y,
  width,
  { figure = false, hand = true, blank = 0 } = {},
) {
  let s = '';
  const textWidth = figure ? Math.floor(width * 0.63) : width;
  for (let i = 0; i < 3; i++)
    s += textLine(x, y + i * 27, textWidth - (i === 2 ? 34 : 0));
  let bottom = y + 70;
  if (figure) {
    const fx = x + width * 0.72,
      fy = y + blank;
    s += `<rect x="${fx}" y="${fy}" width="${width * 0.24}" height="100" fill="none" stroke="#222" stroke-width="3"/><path d="M${fx} ${fy + 100}l${width * 0.24} -100" stroke="#222" stroke-width="3"/>`;
    bottom = Math.max(bottom, fy + 100);
  }
  if (hand) {
    let points = '';
    for (let i = 0; i < 18; i++)
      points += `${x + 16 + i * 13},${bottom + 22 + (i % 4) * 3} `;
    s += `<polyline points="${points}" fill="none" stroke="#285587" stroke-width="3"/>`;
    bottom += 33;
  }
  return { svg: s, box: { x, y, width, height: bottom - y } };
}
const specs = [
  {
    name: 'single-column',
    w: 1000,
    h: 1200,
    questions: Array.from({ length: 4 }, (_, i) => [70, 80 + i * 275, 840, {}]),
  },
  {
    name: 'two-columns',
    w: 1400,
    h: 1400,
    questions: [
      ...Array.from({ length: 3 }, (_, i) => [50, 70 + i * 440, 530, {}]),
      ...Array.from({ length: 3 }, (_, i) => [790, 70 + i * 440, 530, {}]),
    ],
  },
  {
    name: 'long-image',
    w: 900,
    h: 4300,
    questions: Array.from({ length: 11 }, (_, i) => [
      45,
      50 + i * 385,
      800,
      {},
    ]),
  },
  {
    name: 'figures-handwriting',
    w: 1200,
    h: 1300,
    questions: Array.from({ length: 3 }, (_, i) => [
      60,
      75 + i * 420,
      1050,
      { figure: true },
    ]),
  },
  {
    name: 'large-internal-blank',
    w: 1100,
    h: 1300,
    questions: [
      [60, 70, 980, { figure: true, blank: 240 }],
      [60, 760, 980, { figure: true }],
    ],
    knownAmbiguity: true,
  },
  {
    name: 'one-question-separated-paragraphs',
    w: 1100,
    h: 1300,
    questions: [
      [60, 70, 980, {}],
      [60, 820, 980, {}],
    ],
    extra: [340, 367, 394].map((y) => textLine(60, y, 970)).join(''),
    truthFirstHeight: 340,
    knownAmbiguity: true,
  },
  {
    name: 'dense-lines',
    w: 1000,
    h: 1000,
    questions: [],
    extra: Array.from({ length: 24 }, (_, i) =>
      textLine(70, 70 + i * 32, 820),
    ).join(''),
    manualExpected: true,
  },
  { name: 'blank', w: 1000, h: 1400, questions: [], manualExpected: true },
  {
    name: 'dark-shadow',
    w: 1000,
    h: 1400,
    questions: [
      [90, 150, 810, {}],
      [90, 750, 810, {}],
    ],
    extra: '<rect x="0" y="0" width="210" height="1400" fill="#777"/>',
    manualExpected: true,
  },
  {
    name: 'two-columns-with-header',
    w: 1400,
    h: 1400,
    questions: [
      ...Array.from({ length: 3 }, (_, i) => [50, 180 + i * 380, 530, {}]),
      ...Array.from({ length: 3 }, (_, i) => [790, 180 + i * 380, 530, {}]),
    ],
    extra: textLine(50, 50, 1260),
    manualExpected: true,
  },
];
for (const spec of specs) {
  const built = spec.questions.map((args) => question(...args));
  const svg = `<svg width="${spec.w}" height="${spec.h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>${spec.extra || ''}${built.map((b) => b.svg).join('')}</svg>`;
  await sharp(Buffer.from(svg))
    .png()
    .toFile(resolve(artifacts, spec.name + '.png'));
}
await writeFile(
  resolve(artifacts, 'fixtures.json'),
  JSON.stringify(
    { syntheticOnly: true, cases: specs.map((s) => s.name) },
    null,
    2,
  ),
);
console.log(`Created ${specs.length} synthetic fixtures in ${artifacts}`);
