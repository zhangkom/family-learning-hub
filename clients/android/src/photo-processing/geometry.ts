export type Quad = readonly [number, number, number, number, number, number, number, number];
export type Matrix3 = readonly [number, number, number, number, number, number, number, number, number];
export const fullPage: Quad = [0, 0, 1, 0, 1, 1, 0, 1];

/** Four clockwise corners in the EXIF-upright image, using normalized image edges. */
export function validateQuad(value: unknown): asserts value is Quad {
  if (!Array.isArray(value) || value.length !== 8 || value.some((v) =>
    typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1))
    throw new Error('边角必须是图片内的四组坐标');
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = i * 2, b = ((i + 1) % 4) * 2, c = ((i + 2) % 4) * 2;
    const cross = (value[b] - value[a]) * (value[c + 1] - value[b + 1]) -
      (value[b + 1] - value[a + 1]) * (value[c] - value[b]);
    if (cross <= 1e-5 || Math.hypot(value[b] - value[a], value[b + 1] - value[a + 1]) < .005)
      throw new Error('请按左上、右上、右下、左下选取不交叉的四角');
    area += value[a] * value[b + 1] - value[b] * value[a + 1];
  }
  if (area / 2 < .005) throw new Error('选取范围太小');
}

export function validateMatrix(value: unknown): asserts value is Matrix3 {
  if (!Array.isArray(value) || value.length !== 9 || value.some((v) => typeof v !== 'number' || !Number.isFinite(v)))
    throw new Error('图片坐标变换无效');
  const [a, b, c, d, e, f, g, h, i] = value;
  if (Math.abs(a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)) < 1e-12)
    throw new Error('图片坐标变换不可逆');
}

export function mapPoint(matrix: Matrix3, x: number, y: number): readonly [number, number] {
  validateMatrix(matrix);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('坐标无效');
  const z = matrix[6] * x + matrix[7] * y + matrix[8];
  if (Math.abs(z) < 1e-10) throw new Error('坐标无法映射');
  return [(matrix[0] * x + matrix[1] * y + matrix[2]) / z,
    (matrix[3] * x + matrix[4] * y + matrix[5]) / z];
}

/** Screen pointer -> image coordinates, accounting for object-fit: contain letterboxing. */
export function pointerToImage(x: number, y: number, viewport: { left: number; top: number; width: number; height: number },
  image: { width: number; height: number }): readonly [number, number] | null {
  if (![x, y, viewport.left, viewport.top, viewport.width, viewport.height, image.width, image.height].every(Number.isFinite) ||
    viewport.width <= 0 || viewport.height <= 0 || image.width <= 0 || image.height <= 0) throw new Error('预览尺寸无效');
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
  const width = image.width * scale, height = image.height * scale;
  const px = (x - viewport.left - (viewport.width - width) / 2) / width;
  const py = (y - viewport.top - (viewport.height - height) / 2) / height;
  return px < 0 || py < 0 || px > 1 || py > 1 ? null : [px, py];
}

/** A rectangular output question usually maps to a quadrilateral on the source photo. */
export function mapQuestionToOriginal(matrix: Matrix3, rect: { x: number; y: number; width: number; height: number }): Quad {
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 ||
    x + width > 1 + 1e-9 || y + height > 1 + 1e-9) throw new Error('题框超出图片范围');
  return [mapPoint(matrix, x, y), mapPoint(matrix, x + width, y),
    mapPoint(matrix, x + width, y + height), mapPoint(matrix, x, y + height)].flat() as unknown as Quad;
}
