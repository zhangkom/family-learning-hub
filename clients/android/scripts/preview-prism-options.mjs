import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import sharp from 'sharp';

// A second review board focused on optical prisms. No production resources change.
const output = fileURLToPath(new URL('../../../artifacts/design/launcher-prism/prism-round2/', import.meta.url));
mkdirSync(output, { recursive: true });
const linear = (id, stops, x1 = 0, y1 = 0, x2 = 1, y2 = 1) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([offset, color, opacity = 1]) => `<stop offset="${offset}" stop-color="${color}" stop-opacity="${opacity}"/>`).join('')}</linearGradient>`;
const pair = (id, a, b) => linear(id, [[0, a], [1, b]]);
const line = (d, color, width = 1, opacity = 1) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"/>`;
const options = [
  { id: 'P1', name: '经典折射', desc: '玻璃三角 + 三束色光', background: ['#151E38', '#090F24'], defs: pair('glass', '#E7F8FF', '#508FC8') + pair('edge', '#FAFFFF', '#70B9E7'), art: `
    <path d="M26 54 L44 54" stroke="#F5FCFF" stroke-width="2.8" stroke-linecap="round"/>
    <path d="M58 53 L81 42" stroke="#82F0D3" stroke-width="3" stroke-linecap="round"/>
    <path d="M61 57 L83 56" stroke="#82CBFF" stroke-width="3" stroke-linecap="round"/>
    <path d="M63 61 L81 71" stroke="#B69AFC" stroke-width="3" stroke-linecap="round"/>
    <path d="M48 29 L27 73 L71 73 Z" fill="url(#glass)" fill-opacity=".23" stroke="url(#edge)" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M48 29 L52 61 L27 73 Z" fill="#D8F8FF" fill-opacity=".12"/>
    <path d="M48 29 L52 61 L71 73 Z" fill="#9C94FC" fill-opacity=".15"/>
    ${line('M48 31 L52 61 L29 72', '#E5FAFF', .8, .6)}
  ` },
  { id: 'P2', name: '立体三棱柱', desc: '真实棱柱轮廓 · 清爽明亮', background: ['#F3F9FF', '#DDE9FF'], defs: pair('front', '#96F6F2', '#4D96F2') + pair('side', '#8C9BFF', '#6B57D5') + pair('top', '#B2FFF1', '#77E0F4'), art: `
    <path d="M47 32 L62 26 L81 65 L67 73 Z" fill="url(#side)"/>
    <path d="M28 73 L43 65 L81 65 L67 73 Z" fill="#666CEB"/>
    <path d="M47 32 L62 26 L43 65 L28 73 Z" fill="url(#top)"/>
    <path d="M47 32 L28 73 L67 73 Z" fill="url(#front)"/>
    ${line('M47 32 L62 26 L81 65 M47 32 L67 73 L81 65', '#FFFFFF', 1.1, .85)}
    ${line('M47 32 L28 73 L67 73', '#D6FFFF', 1, .6)}
  ` },
  { id: 'P3', name: '光谱切面', desc: '三种切面 · 饱满有力量', background: ['#242850', '#141831'], defs: pair('left', '#F0FFFA', '#5DE5D6') + pair('right', '#BEACFF', '#7264DC') + pair('bottom', '#67BDFC', '#B59CF7'), art: `
    <path d="M53 27 Q54 26 55 28 L80 73 Q81 75 78 75 H29 Q26 75 28 72 Z" fill="url(#left)"/>
    <path d="M54 27 L54 57 L80 74 Q81 75 78 75 Z" fill="url(#right)"/>
    <path d="M28 74 L54 57 L80 74 Q81 75 78 75 H29 Z" fill="url(#bottom)"/>
    ${line('M54 28 L54 57 L29 74 M54 57 L79 74', '#FBFFFF', .9, .68)}
  ` },
  { id: 'P4', name: '留白棱镜', desc: '线条轮廓 · 极简品牌感', background: ['#405EEF', '#273EB9'], defs: pair('band', '#84FFEB', '#B4B3FF'), art: `
    <path d="M54 28 L28 74 H80 Z" fill="none" stroke="#F5FBFF" stroke-width="5" stroke-linejoin="round"/>
    <path d="M54 28 L55 57 L80 74 M55 57 L28 74" fill="none" stroke="#D8E6FF" stroke-width="2.7" stroke-linejoin="round"/>
    <path d="M38 74 H71" stroke="url(#band)" stroke-width="5" stroke-linecap="round"/>
  ` },
  { id: 'P5', name: '冰蓝玻璃', desc: '通透材质 · 安静精致', background: ['#1B2E54', '#09192F'], defs: linear('glass', [[0, '#FFFFFF', .55], [.36, '#93D9FF', .17], [.7, '#8E98F0', .38], [1, '#52DDD2', .5]]) + linear('side', [[0, '#BBCDFF', .48], [1, '#7367EC', .65]]) + pair('front-edge', '#E7FFFF', '#53B3D8') + linear('patch', [[0, '#6CF2E2', .08], [.45, '#8CF8F3', .8], [1, '#A09AFE', .25]], 0, 0, 1, 0), art: `
    <path d="M48 31 L60 26 L80 66 L68 73 Z" fill="url(#side)"/>
    <path d="M28 73 L40 66 H80 L68 73 Z" fill="#769CE0" fill-opacity=".3"/>
    <path d="M48 31 L28 73 H68 Z" fill="url(#glass)" stroke="url(#front-edge)" stroke-width="1.35" stroke-linejoin="round"/>
    <path d="M43 42 L33 65 L57 65 L52 53 Z" fill="#E4FAFF" fill-opacity=".07"/>
    <path d="M38 52 L54 46 L64 65 L33 64 Z" fill="url(#patch)"/>
    ${line('M48 31 L60 26 L80 66 L68 73 M60 26 L40 66', '#B4D4FF', .8, .5)}
    ${line('M48 33 L30 72 H67', '#F0FFFF', .8, .7)}
  ` },
  { id: 'P6', name: '晨光棱镜', desc: '暖色光谱 · 活力与亲和', background: ['#FFF7F0', '#FFE4DD'], defs: pair('left', '#FFC178', '#FF7D75') + pair('right', '#C5A4FB', '#8C66E4') + pair('bottom', '#FCAAAD', '#AF86E6'), art: `
    <g transform="rotate(-9 54 54)">
    <path d="M52 27 Q54 24 56 28 L79 71 Q81 75 77 75 H30 Q26 75 29 71 Z" fill="url(#left)"/>
    <path d="M54 27 L54 57 L80 73 Q80 75 77 75 Z" fill="url(#right)"/>
    <path d="M28 74 L54 57 L80 74 Q80 75 77 75 H30 Z" fill="url(#bottom)"/>
    ${line('M54 28 L54 57 L29 74', '#FFF2E5', 1.15, .8)}
    </g>
  ` },
  { id: 'P7', name: '光束棱镜', desc: '平面折射 · 小图标清晰', background: ['#123D56', '#122A43'], defs: pair('face', '#8EC5DB', '#4986B2'), art: `
    <path d="M47 30 L28 72 H68 Z" fill="url(#face)" fill-opacity=".24" stroke="#E9FCFF" stroke-width="2.2" stroke-linejoin="round"/>
    ${line('M23 55 H41 L56 51', '#F7FFFF', 3.4)}
    <path d="M56 51 L81 41 L82 46 L57 55 Z" fill="#5BE9C7"/>
    <path d="M57 55 L82 49 L83 54 L59 59 Z" fill="#6CCFFF"/>
    <path d="M59 59 L82 57 L82 62 L61 63 Z" fill="#AE9EF9"/>
    <path d="M41 55 L47 30" fill="none" stroke="#C6ECF7" stroke-width=".9" stroke-opacity=".3"/>
  ` },
  { id: 'P8', name: '菱形晶棱', desc: '棱镜切面 · 独立轮廓', background: ['#342557', '#1A1C39'], defs: pair('tl', '#DEFFFB', '#7CF3DC') + pair('tr', '#B9B0FF', '#AB83F5') + pair('bl', '#67D7EE', '#5793ED') + pair('br', '#B59AF6', '#7471E2'), art: `
    <path d="M54 25 L29 53 L54 54 Z" fill="url(#tl)"/>
    <path d="M54 25 L79 53 L54 54 Z" fill="url(#tr)"/>
    <path d="M29 53 L54 81 L54 54 Z" fill="url(#bl)"/>
    <path d="M79 53 L54 81 L54 54 Z" fill="url(#br)"/>
    ${line('M54 25 L54 81 M29 53 L54 54 L79 53', '#F1FFFF', .9, .62)}
  ` },
];
const svg = (option, round = false) => `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="18 18 72 72"><defs>${pair('background', ...option.background)}${option.defs}<clipPath id="clip">${round ? '<circle cx="54" cy="54" r="36"/>' : '<rect x="18" y="18" width="72" height="72" rx="17"/>'}</clipPath></defs><g clip-path="url(#clip)"><rect width="108" height="108" fill="url(#background)"/>${option.art}</g></svg>`;
const cards = [];
const overlays = [];
for (let i = 0; i < options.length; i++) {
  const option = options[i]; const x = 24 + i % 4 * 300; const y = 92 + Math.floor(i / 4) * 367;
  const square = svg(option); const circle = svg(option, true);
  writeFileSync(join(output, `${option.id}.svg`), square);
  await sharp(Buffer.from(square)).resize(512, 512).png().toFile(join(output, `${option.id}.png`));
  await sharp(Buffer.from(circle)).resize(512, 512).png().toFile(join(output, `${option.id}-round.png`));
  cards.push(`<rect x="${x}" y="${y}" width="280" height="343" rx="24" fill="#FFFFFF"/><text x="${x + 18}" y="${y + 31}" fill="#24304B" font-size="18" font-weight="600">${option.id}  ${option.name}</text><text x="${x + 18}" y="${y + 251}" fill="#6E7891" font-size="14">${option.desc}</text><text x="${x + 197}" y="${y + 322}" fill="#8C95A8" font-size="12">48px</text>`);
  overlays.push({ input: await sharp(Buffer.from(square)).resize(168, 168).png().toBuffer(), left: x + 56, top: y + 53 });
  overlays.push({ input: await sharp(Buffer.from(square)).resize(48, 48).png().toBuffer(), left: x + 78, top: y + 280 });
  overlays.push({ input: await sharp(Buffer.from(circle)).resize(48, 48).png().toBuffer(), left: x + 143, top: y + 280 });
}
const board = `<svg xmlns="http://www.w3.org/2000/svg" width="1224" height="850"><rect width="1224" height="850" fill="#F0F3F9"/><g font-family="Microsoft YaHei,Segoe UI,Arial"><text x="24" y="43" fill="#25304C" font-size="25" font-weight="600">知识棱镜AI · 棱镜方向第二轮</text><text x="24" y="70" fill="#6D7890" font-size="15">8 款棱镜候选 · 每款下方附圆角 / 圆形的 48px 桌面预览</text>${cards.join('')}</g></svg>`;
await sharp(Buffer.from(board)).composite(overlays).png().toFile(join(output, 'prism-options.png'));
writeFileSync(join(output, 'options.json'), JSON.stringify({ status: 'awaiting-user-selection', published: false, options: options.map(({ id, name, desc }) => ({ id, name, desc })), references: ['https://www.prismgameapp.com/', 'https://apps.apple.com/us/app/prism-daily-ai-news/id6757409783'], originalVectorCandidates: true }, null, 2) + '\n');
console.log(join(output, 'prism-options.png'));
