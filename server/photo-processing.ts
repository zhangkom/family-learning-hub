import { createHash } from 'node:crypto';
import type { PhotoProcessing } from '../lib/photo-processing';
import { HttpError } from './family-backend';
import { sharp } from './sharp';

const fields = [
  'schemaVersion',
  'algorithmVersion',
  'originalId',
  'studentId',
  'outputId',
  'sourceSha256',
  'sha256',
  'bytes',
  'mime',
  'width',
  'height',
  'sourceWidth',
  'sourceHeight',
  'exifOrientation',
  'decodedWidth',
  'decodedHeight',
  'sourceSpace',
  'outputSpace',
  'corners',
  'quarterTurns',
  'enhancement',
  'jpegQuality',
  'maxEdge',
  'sourceToOutput',
  'outputToSource',
  'quality',
  'createdAt',
] as const;
const qualityFields = [
  'advisoryOnly',
  'warnings',
  'laplacianVariance',
  'darkFraction',
  'backgroundRange',
  'percentile10',
  'percentile90',
] as const;
const warnings = [
  'low-light',
  'low-contrast-or-blank',
  'uneven-light-or-colored-background',
  'possible-blur',
  'small-output',
];
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,
  hash = /^[a-f0-9]{64}$/;
function check(condition: unknown): asserts condition {
  if (!condition)
    throw new HttpError(
      400,
      '照片处理记录无效或与上传图片不符，请重新处理后上传',
    );
}
function object(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  check(value && typeof value === 'object' && !Array.isArray(value));
  const v = value as Record<string, unknown>;
  check(
    Object.keys(v).length === keys.length &&
      Object.keys(v).every((k) => keys.includes(k)) &&
      keys.every((k) => Object.hasOwn(v, k)),
  );
  return v;
}
function number(
  v: unknown,
  min: number,
  max: number,
  integer = false,
): v is number {
  return (
    typeof v === 'number' &&
    Number.isFinite(v) &&
    v >= min &&
    v <= max &&
    (!integer || Number.isSafeInteger(v))
  );
}
function matrix(value: unknown): number[] {
  check(
    Array.isArray(value) &&
      value.length === 9 &&
      value.every((v) => number(v, -1e6, 1e6)),
  );
  const [a, b, c, d, e, f, g, h, i] = value as number[];
  check(
    Math.abs(a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)) >=
      1e-12,
  );
  return [...value];
}
function map(m: number[], x: number, y: number): [number, number] {
  const z = m[6] * x + m[7] * y + m[8];
  check(Number.isFinite(z) && Math.abs(z) > 1e-10);
  return [(m[0] * x + m[1] * y + m[2]) / z, (m[3] * x + m[4] * y + m[5]) / z];
}
const full = [0, 0, 1, 0, 1, 1, 0, 1];
function geometry(p: PhotoProcessing) {
  const q = p.corners;
  check(Array.isArray(q) && q.length === 8 && q.every((v) => number(v, 0, 1)));
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = i * 2,
      b = ((i + 1) % 4) * 2,
      c = ((i + 2) % 4) * 2;
    check(
      (q[b] - q[a]) * (q[c + 1] - q[b + 1]) -
        (q[b + 1] - q[a + 1]) * (q[c] - q[b]) >
        1e-5,
    );
    check(Math.hypot(q[b] - q[a], q[b + 1] - q[a + 1]) >= 0.005);
    area += q[a] * q[b + 1] - q[b] * q[a + 1];
  }
  check(area / 2 >= 0.005);
  const forward = matrix(p.sourceToOutput),
    reverse = matrix(p.outputToSource);
  const z = q
    .filter((_, i) => i % 2 === 0)
    .map((x, i) => forward[6] * x + forward[7] * q[i * 2 + 1] + forward[8]);
  check(z.every((v) => v > 1e-10) || z.every((v) => v < -1e-10));
  for (let i = 0; i < 4; i++) {
    const target = ((i + p.quarterTurns) % 4) * 2,
      point = map(forward, q[i * 2], q[i * 2 + 1]),
      back = map(reverse, full[target], full[target + 1]);
    check(
      Math.abs(point[0] - full[target]) < 1e-5 &&
        Math.abs(point[1] - full[target + 1]) < 1e-5,
    );
    check(
      Math.abs(back[0] - q[i * 2]) < 1e-5 &&
        Math.abs(back[1] - q[i * 2 + 1]) < 1e-5,
    );
  }
  // Corner mappings fix the projective transform; also check the interior inverse.
  for (const [x, y] of [
    [0.5, 0.5],
    [0.2, 0.8],
    [0.8, 0.2],
  ]) {
    const src = map(reverse, x, y),
      back = map(forward, ...src);
    check(
      src.every((v) => number(v, 0, 1)) &&
        Math.abs(back[0] - x) < 1e-5 &&
        Math.abs(back[1] - y) < 1e-5,
    );
  }
  const w = p.exifOrientation >= 5 ? p.decodedHeight : p.decodedWidth,
    h = p.exifOrientation >= 5 ? p.decodedWidth : p.decodedHeight;
  const distance = (a: number, b: number) =>
    Math.hypot((q[a] - q[b]) * w, (q[a + 1] - q[b + 1]) * h);
  const cw = (distance(0, 2) + distance(6, 4)) / 2,
    ch = (distance(0, 6) + distance(2, 4)) / 2;
  const scale = Math.min(
    1,
    p.maxEdge / Math.max(cw, ch),
    Math.sqrt(8_000_000 / (cw * ch)),
  );
  const dimensions = [
    Math.max(1, Math.round(cw * scale)),
    Math.max(1, Math.round(ch * scale)),
  ];
  if (p.quarterTurns % 2) dimensions.reverse();
  check(
    Math.abs(p.width - dimensions[0]) <= 1 &&
      Math.abs(p.height - dimensions[1]) <= 1,
  );
}

export async function validatePhotoProcessing(
  raw: FormDataEntryValue | null,
  sourceKind: FormDataEntryValue | null,
  studentId: string,
  content: Uint8Array,
  mime: string,
): Promise<PhotoProcessing | undefined> {
  if (raw === null && sourceKind === null) return undefined;
  check(
    sourceKind === 'processed-photo' &&
      typeof raw === 'string' &&
      raw.length <= 16384,
  );
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    check(false);
  }
  const v = object(value, fields),
    quality = object(v.quality, qualityFields);
  check(
    v.schemaVersion === 1 &&
      v.algorithmVersion === 'android-photo-v1' &&
      v.studentId === studentId,
  );
  for (const k of ['originalId', 'outputId'])
    check(typeof v[k] === 'string' && uuid.test(v[k]));
  for (const k of ['sourceSha256', 'sha256'])
    check(typeof v[k] === 'string' && hash.test(v[k]));
  check(
    v.mime === 'image/jpeg' &&
      mime === 'image/jpeg' &&
      v.sourceSpace === 'exif-upright-normalized-edges' &&
      v.outputSpace === 'normalized-edges',
  );
  check(
    v.bytes === content.length &&
      number(v.bytes, 1, 8 * 1024 * 1024, true) &&
      v.sha256 === createHash('sha256').update(content).digest('hex'),
  );
  for (const k of ['width', 'height']) check(number(v[k], 16, 4096, true));
  for (const k of ['sourceWidth', 'sourceHeight'])
    check(number(v[k], 1, 50000, true));
  for (const k of ['decodedWidth', 'decodedHeight'])
    check(number(v[k], 1, 8194, true));
  check(
    number(v.exifOrientation, 1, 8, true) &&
      number(v.quarterTurns, 0, 3, true) &&
      number(v.jpegQuality, 90, 100, true) &&
      number(v.maxEdge, 256, 4096, true),
  );
  check(v.enhancement === 'none' || v.enhancement === 'light');
  check(number(v.createdAt, 1, 8640000000000000, true));
  check(
    quality.advisoryOnly === true &&
      Array.isArray(quality.warnings) &&
      quality.warnings.length <= 5 &&
      new Set(quality.warnings).size === quality.warnings.length &&
      quality.warnings.every((w) => warnings.includes(w)),
  );
  check(
    number(quality.laplacianVariance, 0, 1_100_000) &&
      number(quality.darkFraction, 0, 1),
  );
  for (const k of ['backgroundRange', 'percentile10', 'percentile90'])
    check(number(quality[k], 0, 255));
  check(Number(quality.percentile10) <= Number(quality.percentile90));
  const p = v as unknown as PhotoProcessing;
  check(
    p.sourceWidth * p.sourceHeight <= 100_000_000 &&
      p.decodedWidth * p.decodedHeight <= 12_020_000 &&
      p.width * p.height <= 8_010_000 &&
      Math.max(p.width, p.height) <= p.maxEdge,
  );
  const sw = p.exifOrientation >= 5 ? p.sourceHeight : p.sourceWidth,
    sh = p.exifOrientation >= 5 ? p.sourceWidth : p.sourceHeight;
  check(
    p.decodedWidth <= sw &&
      p.decodedHeight <= sh &&
      Math.abs(p.decodedWidth * sh - p.decodedHeight * sw) <= sw + sh,
  );
  geometry(p);
  try {
    const image = sharp(content, {
        limitInputPixels: 8_010_000,
        failOn: 'error',
      }),
      metadata = await image.metadata();
    check(
      metadata.format === 'jpeg' &&
        metadata.width === p.width &&
        metadata.height === p.height &&
        (!metadata.orientation || metadata.orientation === 1) &&
        (!metadata.pages || metadata.pages === 1),
    );
    // Decode pixels as well as headers, rejecting truncated JPEGs before persisting.
    await image.resize(1, 1).raw().toBuffer();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    check(false);
  }
  // Canonical order makes retries independent of incoming JSON property order.
  return Object.fromEntries(
    fields.map((k) => [
      k,
      k === 'quality'
        ? Object.fromEntries(qualityFields.map((q) => [q, quality[q]]))
        : p[k],
    ]),
  ) as PhotoProcessing;
}
