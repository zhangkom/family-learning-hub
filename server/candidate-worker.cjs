// Trusted worker program bundled as text; image bytes arrive separately on stdin.
// This process gets no model credentials and never writes files or calls a model.
/* eslint-disable @typescript-eslint/no-require-imports -- Fixed CommonJS child program, independent of the web module loader. */
const request = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const sharp = require(request.sharpPath);
sharp.cache(false);
sharp.concurrency(1);
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
async function detect(bytes) {
  const m = await sharp(bytes, {
    limitInputPixels: 32_000_000,
    failOn: 'error',
  }).metadata();
  if (
    !['jpeg', 'png', 'webp'].includes(m.format) ||
    (m.pages || 1) > 1 ||
    !m.width ||
    !m.height
  )
    throw new Error('INVALID_IMAGE');
  const swapped = (m.orientation || 1) >= 5;
  const image = {
    width: swapped ? m.height : m.width,
    height: swapped ? m.width : m.height,
  };
  if (image.width * image.height > 32_000_000) throw new Error('PIXEL_LIMIT');
  send({ kind: 'image', image });
  const scale = Math.min(
    1,
    1200 / image.width,
    Math.sqrt(2_000_000 / (image.width * image.height)),
  );
  const { data, info } = await sharp(bytes, {
    limitInputPixels: 32_000_000,
    failOn: 'error',
  })
    .rotate()
    .flatten({ background: '#fff' })
    .resize(
      Math.max(1, Math.floor(image.width * scale)),
      Math.max(1, Math.floor(image.height * scale)),
    )
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width,
    h = info.height,
    n = w * h;
  if (n > 2_000_000) throw new Error('PIXEL_LIMIT');
  const result = (status, boxes, warning) => ({
    algorithm: 'layout-v1',
    coordinateSpace: 'oriented-normalized',
    image,
    status,
    candidates: boxes.map((b, i) => ({
      id: `candidate-${i + 1}`,
      order: i,
      reason: 'LAYOUT_GAP',
      region: {
        x: b.x0 / w,
        y: b.y0 / h,
        width: (b.x1 - b.x0) / w,
        height: (b.y1 - b.y0) / h,
      },
    })),
    warnings: [
      'LAYOUT_ONLY',
      'REVIEW_FIGURES_AND_HANDWRITING',
      ...(warning ? [warning] : []),
    ],
  });
  const manual = (warning) => result('manual_required', [], warning);
  const mask = new Uint8Array(n),
    queue = new Int32Array(n),
    components = [];
  for (let i = 0; i < n; i++) mask[i] = data[i] < 185 ? 1 : 0;
  for (let p = 0; p < n; p++) {
    if (mask[p] !== 1) continue;
    let lo = 0,
      hi = 1,
      x0 = w,
      y0 = h,
      x1 = 0,
      y1 = 0;
    queue[0] = p;
    mask[p] = 2;
    while (lo < hi) {
      const q = queue[lo++],
        x = q % w,
        y = Math.floor(q / w);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const z of [
        x > 0 ? q - 1 : -1,
        x + 1 < w ? q + 1 : -1,
        y > 0 ? q - w : -1,
        y + 1 < h ? q + w : -1,
      ])
        if (z >= 0 && mask[z] === 1) {
          mask[z] = 2;
          queue[hi++] = z;
        }
    }
    if (hi < 4) {
      for (let i = 0; i < hi; i++) mask[queue[i]] = 0;
      continue;
    }
    if (hi > n * 0.075) return manual('LARGE_DARK_REGION');
    components.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, area: hi });
    if (components.length > 12000) return manual('TOO_MANY_FRAGMENTS');
  }
  if (components.length < 8) return manual('BLANK_OR_TOO_LITTLE_INK');
  const glyphs = components
    .filter(
      (c) =>
        c.y1 - c.y0 >= 4 && c.y1 - c.y0 < h * 0.06 && c.x1 - c.x0 < w * 0.1,
    )
    .map((c) => c.y1 - c.y0)
    .sort((a, b) => a - b);
  const gh = glyphs[Math.floor(glyphs.length / 2)] || 0;
  if (gh < 5) return manual('TEXT_TOO_SMALL');
  const boundsOf = (cs) =>
    cs.reduce(
      (b, c) => ({
        x0: Math.min(b.x0, c.x0),
        y0: Math.min(b.y0, c.y0),
        x1: Math.max(b.x1, c.x1),
        y1: Math.max(b.y1, c.y1),
      }),
      { x0: w, y0: h, x1: 0, y1: 0 },
    );
  const bounds = boundsOf(components),
    bw = bounds.x1 - bounds.x0,
    bh = bounds.y1 - bounds.y0;
  if (bounds.x0 < 2 || bounds.y0 < 2 || bounds.x1 > w - 2 || bounds.y1 > h - 2)
    return manual('INK_TOUCHES_IMAGE_EDGE');
  const cols = new Int32Array(w);
  for (let y = bounds.y0; y < bounds.y1; y++)
    for (let x = bounds.x0; x < bounds.x1; x++) if (mask[y * w + x]) cols[x]++;
  function gutter(tolerance) {
    const gaps = [];
    let start = null;
    const end = Math.floor(bounds.x0 + bw * 0.77);
    for (let x = Math.ceil(bounds.x0 + bw * 0.23); x <= end; x++) {
      if (x < end && cols[x] <= bh * tolerance) {
        if (start === null) start = x;
      } else if (start !== null) {
        if (x - start > bw * 0.035) gaps.push([start, x]);
        start = null;
      }
    }
    let best = null;
    for (const [left, right] of gaps) {
      const l = components.filter((c) => c.x1 <= left),
        r = components.filter((c) => c.x0 >= right);
      const la = l.reduce((s, c) => s + c.area, 0),
        ra = r.reduce((s, c) => s + c.area, 0);
      if (!l.length || !r.length || Math.min(la, ra) / (la + ra) < 0.18)
        continue;
      const lb = boundsOf(l),
        rb = boundsOf(r);
      if (Math.min(lb.y1 - lb.y0, rb.y1 - rb.y0) < bh * 0.65) continue;
      if (!best || right - left > best[1] - best[0]) best = [left, right];
    }
    return best;
  }
  const split = gutter(0.002),
    loose = gutter(0.055);
  if (!split && loose) return manual('MIXED_COLUMNS_OR_CROSSING_CONTENT');
  const ranges = split
    ? [
        [bounds.x0, split[0]],
        [split[1], bounds.x1],
      ]
    : [[bounds.x0, bounds.x1]];
  const boxes = [];
  let fragments = 0;
  for (const [left, right] of ranges) {
    const row = new Int32Array(h);
    for (let y = bounds.y0; y < bounds.y1; y++)
      for (let x = left; x < right; x++) if (mask[y * w + x]) row[y]++;
    const bands = [];
    let top = null;
    for (let y = bounds.y0; y <= bounds.y1; y++) {
      if (row[y] > 1) {
        if (top === null) top = y;
      } else if (top !== null) {
        bands.push([top, y]);
        top = null;
      }
    }
    if (!bands.length) continue;
    const gaps = bands
      .slice(1)
      .map((b, i) => b[0] - bands[i][1])
      .sort((a, b) => a - b);
    const threshold = Math.max(
      gh * 2.8,
      (gaps[Math.floor(gaps.length * 0.3)] || gh) * 3.2,
      18,
    );
    const groups = [];
    let current = [...bands[0]];
    for (let i = 1; i < bands.length; i++) {
      if (bands[i][0] - current[1] >= threshold) {
        groups.push(current);
        current = [...bands[i]];
      } else current[1] = bands[i][1];
    }
    groups.push(current);
    for (const [top, bottom] of groups) {
      const cs = components.filter(
        (c) => c.x0 >= left && c.x1 <= right && c.y0 >= top && c.y1 <= bottom,
      );
      if (!cs.length || bottom - top < gh * 2.5) {
        fragments++;
        continue;
      }
      const pad = Math.max(5, Math.round(gh * 0.7)),
        b = boundsOf(cs);
      boxes.push({
        x0: Math.max(0, b.x0 - pad),
        x1: Math.min(w, b.x1 + pad),
        y0: Math.max(0, top - pad),
        y1: Math.min(h, bottom + pad),
      });
      if (boxes.length > 24) return manual('TOO_MANY_CANDIDATES');
    }
  }
  if (fragments) return manual('UNRESOLVED_SMALL_BLOCKS');
  if (boxes.length < 2) return manual('NO_RELIABLE_SEPARATORS');
  return result('candidates', boxes);
}
detect(Buffer.from(request.bytes, 'base64'))
  .then((result) => send({ kind: 'result', result }))
  .catch((error) =>
    send({
      kind: 'failure',
      code: /pixel limit|PIXEL_LIMIT/i.test(String(error?.message))
        ? 'PIXEL_LIMIT'
        : 'INVALID_IMAGE',
    }),
  );
