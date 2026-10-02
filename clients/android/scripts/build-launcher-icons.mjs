import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import sharp from 'sharp';

// One geometry source for native vectors, legacy bitmaps and the in-app mark.
// Foreground fits inside Android's central 66 dp safe zone in a 108 dp layer.
const client = fileURLToPath(new URL('../', import.meta.url));
const res = join(client, 'android/app/src/main/res');
const design = join(client, '../../artifacts/design/launcher-prism');
const output = resolve(process.argv[2] || join(design, 'selected-P3'));
mkdirSync(output, { recursive: true });
// A diagonal objectBoundingBox gradient is transformed non-uniformly in SVG.
// Android gradients use viewport coordinates; preserve the same color field.
const boundingGradient = (x, y, right, bottom, a, b) => {
  const width = right - x;
  const height = bottom - y;
  const denominator = width * width + height * height;
  return [x, y, x + 2 * width * height * height / denominator,
    y + 2 * width * width * height / denominator, a, b];
};
const gradients = {
  background: [0, 0, 108, 108, '#242850', '#141831'],
  // These coordinates reproduce the approved SVG's objectBoundingBox gradients.
  left: boundingGradient(27.2, 26.6666666667, 80.25, 75, '#F0FFFA', '#5DE5D6'),
  right: boundingGradient(54, 27, 80.25, 75, '#BEACFF', '#7264DC'),
  base: boundingGradient(28, 57, 80.25, 75, '#67BDFC', '#B59CF7'),
};
const paths = [
  { d: 'M53,27 Q54,26 55,28 L80,73 Q81,75 78,75 H29 Q26,75 28,72 Z', fill: 'left' },
  { d: 'M54,27 L54,57 L80,74 Q81,75 78,75 Z', fill: 'right' },
  { d: 'M28,74 L54,57 L80,74 Q81,75 78,75 H29 Z', fill: 'base' },
  { d: 'M54,28 L54,57 L29,74 M54,57 L79,74', stroke: '#FBFFFF', width: 0.9, opacity: 0.68 },
];
const mono = [
  // Transparent seams keep the three facets visible when the system tints them.
  { d: 'M53.2,28.6 L53.2,56.5 L29.3,72.5 Z', fill: '#FFFFFF' },
  { d: 'M54.8,28.6 L54.8,56.5 L78.4,72.5 Z', fill: '#FFFFFF' },
  { d: 'M30.2,74 L54,58 L77.8,74 Z', fill: '#FFFFFF' },
];
const defs = Object.entries(gradients).map(([id, [, , , , a, b]]) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`).join('');
const svgPaths = (items, themed = false) => items.map(p => `<path d="${p.d}" fill="${p.fill ? (gradients[p.fill] ? `url(#${p.fill})` : p.fill) : 'none'}"${p.stroke ? ` stroke="${themed ? '#384268' : p.stroke}" stroke-width="${p.width}" stroke-linecap="round" stroke-linejoin="round"` : ''}${p.opacity ? ` stroke-opacity="${p.opacity}"` : ''}/>`).join('');
const artwork = svgPaths(paths);
const svg = (mask = '', themed = false) => `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="18 18 72 72"><defs>${defs}${mask ? `<clipPath id="mask">${mask}</clipPath>` : ''}</defs><g${mask ? ' clip-path="url(#mask)"' : ''}><rect width="108" height="108" fill="${themed ? '#E0E6FC' : 'url(#background)'}"/>${themed ? svgPaths(mono, true).replaceAll('fill="#FFFFFF"', 'fill="#384268"') : artwork}</g></svg>`;
const roundMask = '<circle cx="54" cy="54" r="36"/>';
const squareMask = '<rect x="18" y="18" width="72" height="72" rx="17"/>';

const xmlGradient = id => {
  const [startX, startY, endX, endY, a, b] = gradients[id];
  return `<aapt:attr name="android:fillColor"><gradient android:type="linear" android:startX="${startX}" android:startY="${startY}" android:endX="${endX}" android:endY="${endY}"><item android:offset="0" android:color="${a}"/><item android:offset="1" android:color="${b}"/></gradient></aapt:attr>`;
};
const xmlPaths = (items, themed = false) => items.map(p => `    <path android:pathData="${p.d}"${gradients[p.fill] ? '' : ` android:fillColor="${p.fill || '#00000000'}"`}${p.stroke ? ` android:strokeColor="${themed ? '#FFFFFF' : p.stroke}" android:strokeWidth="${p.width}" android:strokeLineCap="round" android:strokeLineJoin="round"` : ''}${p.opacity ? ` android:strokeAlpha="${p.opacity}"` : ''}>${gradients[p.fill] ? xmlGradient(p.fill) : ''}</path>`).join('\n');
const vector = (body, mask = '') => `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">\n${mask ? `<group><clip-path android:pathData="${mask}"/>` : ''}\n${body}\n${mask ? '</group>' : ''}\n</vector>\n`;
const saveRes = (name, content) => {
  const file = join(res, name); mkdirSync(resolve(file, '..'), { recursive: true }); writeFileSync(file, content);
};
const background = `    <path android:pathData="M0,0 H108 V108 H0 Z">${xmlGradient('background')}</path>`;
saveRes('drawable/prism_background.xml', vector(background));
saveRes('drawable/prism_foreground.xml', vector(xmlPaths(paths)));
saveRes('drawable/prism_monochrome.xml', vector(xmlPaths(mono, true)));
for (const name of ['ic_launcher', 'ic_launcher_round']) {
  saveRes(`mipmap-anydpi-v26/${name}.xml`, `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@drawable/prism_background"/>\n    <foreground android:drawable="@drawable/prism_foreground"/>\n    <monochrome android:drawable="@drawable/prism_monochrome"/>\n</adaptive-icon>\n`);
  const mask = name.endsWith('round')
    ? 'M90,54 A36,36 0,1 1,18 54 A36,36 0,1 1,90 54 Z'
    : 'M35,18 H73 A17,17 0,0 1,90 35 V73 A17,17 0,0 1,73 90 H35 A17,17 0,0 1,18 73 V35 A17,17 0,0 1,35 18 Z';
  // This legacy vector fills the launcher viewport exactly; no double padding.
  saveRes(`mipmap-anydpi/${name}.xml`, vector(`${background}\n${xmlPaths(paths)}`, mask).replace('android:width="108dp" android:height="108dp"', 'android:width="48dp" android:height="48dp"').replace('android:viewportWidth="108" android:viewportHeight="108"', 'android:viewportWidth="72" android:viewportHeight="72"').replace('<group>', '<group android:translateX="-18" android:translateY="-18">'));
}
for (const [density, size, foregroundSize] of [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]]) {
  for (const [name, mask] of [['ic_launcher', squareMask], ['ic_launcher_round', roundMask]]) {
    saveRes(`mipmap-${density}/${name}.png`, await sharp(Buffer.from(svg(mask))).resize(size, size).png().toBuffer());
  }
  const foreground = `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108"><defs>${defs}</defs>${artwork}</svg>`;
  saveRes(`mipmap-${density}/ic_launcher_foreground.png`, await sharp(Buffer.from(foreground)).resize(foregroundSize, foregroundSize).png().toBuffer());
}
// Remove template and former-brand artwork from every old resource alias.
saveRes('drawable/zhiran_background.xml', vector(background));
saveRes('drawable/zhiran_foreground.xml', vector(xmlPaths(paths)));
saveRes('drawable/ic_launcher_background.xml', vector(background));
saveRes('drawable-v24/ic_launcher_foreground.xml', vector(xmlPaths(paths)));
saveRes('values/ic_launcher_background.xml', '<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">#242850</color></resources>\n');

const jsxDefs = defs.replaceAll('stop-color', 'stopColor');
const jsxPaths = artwork.replaceAll('stroke-width', 'strokeWidth').replaceAll('stroke-linecap', 'strokeLinecap').replaceAll('stroke-linejoin', 'strokeLinejoin').replaceAll('stroke-opacity', 'strokeOpacity');
// SVG gradients need per-instance IDs when multiple marks share a screen.
const scoped = value => value.replace(/id="([^" ]+)"/g, 'id={`${id}-$1`}').replace(/"url\(#([^ )]+)\)"/g, '{`url(#${id}-$1)`}');
writeFileSync(join(client, 'src/Brand.tsx'), `// Generated by scripts/build-launcher-icons.mjs.\nimport { useId } from 'react';\n\nexport function BrandMark({ size = 38 }: { size?: number }) {\n  const id = useId();\n  return (\n    <svg className="brand-mark" width={size} height={size} viewBox="18 18 72 72" aria-hidden="true" focusable="false">\n      <defs>${scoped(jsxDefs)}<clipPath id={\`\${id}-clip\`}>${squareMask}</clipPath></defs>\n      <g clipPath={\`url(#\${id}-clip)\`}>\n        <rect width="108" height="108" fill={\`url(#\${id}-background)\`}/>\n        ${scoped(jsxPaths)}\n      </g>\n    </svg>\n  );\n}\n`);
writeFileSync(join(output, 'prism-icon.svg'), svg(squareMask));
for (const [name, mask, themed] of [['prism-icon', squareMask, false], ['prism-round', roundMask, false], ['prism-themed', squareMask, true]]) {
  await sharp(Buffer.from(svg(mask, themed))).resize(512, 512).png().toFile(join(output, `${name}.png`));
}
const tiles = [];
for (const [index, mask] of [squareMask, roundMask].entries()) {
  for (const [column, size] of [192, 64, 48, 32].entries()) {
    tiles.push({ input: await sharp(Buffer.from(svg(mask))).resize(size, size).png().toBuffer(), left: 36 + column * 220, top: 70 + index * 242 + (192 - size) / 2 });
  }
}
const labels = `<svg width="920" height="620" xmlns="http://www.w3.org/2000/svg"><rect width="920" height="620" rx="24" fill="#F3F5FB"/><g font-family="Microsoft YaHei,Segoe UI,Arial" fill="#283350"><text x="36" y="40" font-size="20">P3 光谱切面 · 已选定的桌面图标</text>${[192, 64, 48, 32].map((size, i) => `<text x="${36 + i * 220}" y="565" font-size="17">${size} px</text>`).join('')}<text x="36" y="600" font-size="15">圆角 / 圆形 · 实际小尺寸</text></g></svg>`;
await sharp(Buffer.from(labels)).composite(tiles).png().toFile(join(output, 'launcher-preview.png'));
const approvedPath = join(design, 'prism-round2/P3.png');
// Compare visible colors; RGB at nearly transparent edge pixels is unstable.
const approved = await sharp(approvedPath).flatten({ background: '#FFFFFF' }).raw().toBuffer();
const generated = await sharp(join(output, 'prism-icon.png')).flatten({ background: '#FFFFFF' }).raw().toBuffer();
if (approved.length !== generated.length) throw new Error('Approved and generated icon dimensions differ.');
let totalDifference = 0;
let maximumDifference = 0;
for (let i = 0; i < approved.length; i++) {
  const difference = Math.abs(approved[i] - generated[i]);
  totalDifference += difference;
  maximumDifference = Math.max(maximumDifference, difference);
}
// Changing SVG gradient units may round a channel by one step, never the artwork.
if (maximumDifference > 2) throw new Error(`Generated artwork differs from approved P3: maximum channel difference ${maximumDifference}.`);
writeFileSync(join(output, 'icon-verification.json'), JSON.stringify({ selectedProposal: 'P3', selectedName: '光谱切面', foregroundLayerDp: 108, safeZoneDp: 66, legacyDensities: 5, masks: ['rounded-square', 'circle'], previewSizes: [192, 64, 48, 32], monochromeLayer: true, approvedImageSha256: createHash('sha256').update(readFileSync(approvedPath)).digest('hex'), comparisonBackground: '#FFFFFF', maximumChannelDifference: maximumDifference, meanChannelDifference: totalDifference / approved.length, nativeDeviceTested: false }, null, 2) + '\n');
console.log(JSON.stringify({ output, generated: 'native vectors, 15 bitmaps, BrandMark, previews' }));
