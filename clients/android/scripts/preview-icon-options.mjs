import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import sharp from 'sharp';

// Review-only alternatives. This script does not change installed app resources.
const directory = fileURLToPath(new URL('../../../artifacts/design/launcher-prism/options/', import.meta.url));
mkdirSync(directory, { recursive: true });
const gradient = (id, a, b, x2 = 1, y2 = 1) => `<linearGradient id="${id}" x2="${x2}" y2="${y2}"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const options = [
  { id: 'A', name: '光学棱镜', desc: '直观呼应名字 · 深蓝科技感', svg: readFileSync(join(directory, '../prism-icon.svg'), 'utf8') },
  { id: 'B', name: '折页棱镜', desc: '书页与棱镜结合 · 简洁醒目', background: ['#3978FF', '#244CDC'], defs: gradient('b-left', '#FFFFFF', '#C3EBFF') + gradient('b-right', '#A9F5FF', '#70C4FF'), art: `
    <path d="M29 40 Q40 35 53 45 L53 77 Q40 67 29 69 Z" fill="url(#b-left)"/>
    <path d="M56 45 Q69 35 80 40 L80 69 Q68 67 56 77 Z" fill="url(#b-right)"/>
    <path d="M54.5 29 L72 41 L54.5 50 L37 41 Z" fill="#FFFFFF"/>
    <path d="M54.5 50 L54.5 74 L37 41 Z" fill="#B4E7FF"/>
    <path d="M54.5 50 L72 41 L54.5 74 Z" fill="#6F9DFC"/>
  ` },
  { id: 'C', name: '极光晶体', desc: '浅色底与立体切面 · 清爽精致', background: ['#F3F9FF', '#DDE9FD'], defs: gradient('c-top', '#6DF0E0', '#43CAEF') + gradient('c-left', '#4389F4', '#465DE2') + gradient('c-right', '#ACA1FF', '#7068E7'), art: `
    <path d="M54 26 L78 40 L54 54 L30 40 Z" fill="url(#c-top)"/>
    <path d="M30 40 L54 54 L54 81 L30 67 Z" fill="url(#c-left)"/>
    <path d="M54 54 L78 40 L78 67 L54 81 Z" fill="url(#c-right)"/>
    <path d="M30 40 L54 54 L78 40 M54 54 L54 81" fill="none" stroke="#F3FFFF" stroke-opacity=".75" stroke-width="1.2"/>
  ` },
  { id: 'D', name: '灵感星芒', desc: 'AI 感最强 · 柔和而有辨识度', background: ['#3B39AE', '#191C55'], defs: gradient('d-star', '#FFFFFF', '#65F2E5') + gradient('d-small', '#CDA8FF', '#8C9AFF'), art: `
    <path d="M56 26 C59 43 66 49 81 52 C65 55 59 62 56 79 C52 62 45 55 29 52 C46 49 52 43 56 26 Z" fill="url(#d-star)"/>
    <path d="M31 65 C33 71 36 73 42 75 C36 77 33 80 31 86 C29 80 26 77 20 75 C26 73 29 71 31 65 Z" fill="url(#d-small)" transform="translate(8 -4) scale(.85)"/>
  ` },
  { id: 'E', name: '知识之窗', desc: '教育属性最明确 · 亲和稳重', background: ['#087F94', '#10516E'], defs: gradient('e-page', '#FFFFFF', '#D2FAF3') + gradient('e-right', '#B1F1E7', '#71D1E4'), art: `
    <path d="M27 42 Q41 39 52 48 L52 78 Q41 70 27 73 Z" fill="url(#e-page)"/>
    <path d="M56 48 Q67 39 81 42 L81 73 Q67 70 56 78 Z" fill="url(#e-right)"/>
    <path d="M54 24 Q57 34 66 37 Q57 40 54 49 Q51 40 42 37 Q51 34 54 24 Z" fill="#FFFFFF"/>
  ` },
  { id: 'F', name: '光谱之门', desc: '极简几何 · 更像成熟商业品牌', background: ['#172A53', '#17203E'], defs: gradient('f-ribbon', '#60F0DE', '#87AEFF', 0, 1) + gradient('f-side', '#A4A0FF', '#8D73F0', 0, 1), art: `
    <path d="M31 78 L47 35 Q54 19 62 35 L78 78 L65 78 L54 44 L43 78 Z" fill="url(#f-ribbon)"/>
    <path d="M55 30 Q59 30 62 35 L78 78 L65 78 L54 44 Z" fill="url(#f-side)"/>
    <path d="M46 65 L62 65" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/>
  ` },
];
const makeSvg = option => option.svg || `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="18 18 72 72"><defs>${gradient('bg', ...option.background)}${option.defs}<clipPath id="clip"><rect x="18" y="18" width="72" height="72" rx="17"/></clipPath></defs><g clip-path="url(#clip)"><rect width="108" height="108" fill="url(#bg)"/>${option.art}</g></svg>`;
const cards = [];
const cells = [];
for (let i = 0; i < options.length; i++) {
  const o = options[i]; const svg = makeSvg(o);
  writeFileSync(join(directory, `${o.id}.svg`), svg);
  await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(join(directory, `${o.id}.png`));
  const x = 24 + i % 3 * 324; const y = 84 + Math.floor(i / 3) * 392;
  cards.push(`<rect x="${x}" y="${y}" width="300" height="368" rx="24" fill="white"/><text x="${x + 20}" y="${y + 31}" font-size="18" font-weight="600" fill="#222E4A">${o.id}  ${o.name}</text><text x="${x + 20}" y="${y + 292}" font-size="14" fill="#64708A">${o.desc}</text><text x="${x + 190}" y="${y + 350}" font-size="12" fill="#8993A8">48px</text>`);
  cells.push({ input: await sharp(Buffer.from(svg)).resize(174, 174).png().toBuffer(), left: x + 63, top: y + 58 });
  cells.push({ input: await sharp(Buffer.from(svg)).resize(48, 48).png().toBuffer(), left: x + 124, top: y + 310 });
}
const board = `<svg xmlns="http://www.w3.org/2000/svg" width="1020" height="900"><rect width="1020" height="900" fill="#F0F3F9"/><g font-family="Microsoft YaHei,Segoe UI,Arial"><text x="24" y="42" font-size="24" font-weight="600" fill="#253351">知识棱镜AI · 手机桌面图标候选</text><text x="24" y="66" font-size="14" fill="#69768D">每款下方附 48px 实际尺寸，先选形状，再调整配色</text>${cards.join('')}</g></svg>`;
await sharp(Buffer.from(board)).composite(cells).png().toFile(join(directory, 'icon-options.png'));
writeFileSync(join(directory, 'options.json'), JSON.stringify({ status: 'awaiting-user-selection', published: false, options: options.map(({ id, name, desc }) => ({ id, name, desc })) }, null, 2) + '\n');
console.log(join(directory, 'icon-options.png'));
