import { sharp } from './sharp';
import { HttpError } from './family-backend';
import { questionContext } from '../lib/question-context';
import type { Question } from '../lib/mobile';

export const QUESTION_IMAGE_PARTS_LIMIT = 24;
export const QUESTION_IMAGE_BYTES_LIMIT = 24 * 1024 * 1024;
const options = { limitInputPixels: 32_000_000, failOn: 'error' as const };
async function selectedCrops(bytes: Uint8Array, question: Question, all: Question[]) {
  const regions = questionContext(question, all).regions;
  if (!regions.some(r => r.kind === 'stem')) throw new HttpError(400, '请先框出题干');
  const metadata = await sharp(bytes, options).metadata();
  if (!metadata.width || !metadata.height || (metadata.pages || 1) > 1) throw new Error('Unsupported image');
  const swapped = (metadata.orientation || 1) >= 5;
  const width = swapped ? metadata.height : metadata.width, height = swapped ? metadata.width : metadata.height;
  const boxes = regions.map(r => {
    const left = Math.max(0, Math.floor(r.x * width)), top = Math.max(0, Math.floor(r.y * height));
    return { left, top, width: Math.min(width, Math.ceil((r.x + r.width) * width)) - left, height: Math.min(height, Math.ceil((r.y + r.height) * height)) - top };
  }).filter((a, index, list) => !list.some((b, other) => other !== index && b.left <= a.left && b.top <= a.top && b.left + b.width >= a.left + a.width && b.top + b.height >= a.top + a.height && (b.left !== a.left || b.top !== a.top || b.width !== a.width || b.height !== a.height || other < index)))
    .sort((a, b) => a.top - b.top || a.left - b.left);
  if (!boxes.length || boxes.some(box => box.width < 8 || box.height < 8)) throw new HttpError(400, '选框太小，请框出完整题目');
  return boxes;
}
function cropError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  throw new HttpError(400, '图片无法裁切或尺寸过大，原件仍保留，请换清晰照片');
}
/** Full-resolution review image; separate boxes never include intervening questions. */
export async function cropQuestionImage(bytes: Uint8Array, question: Question, all: Question[]) {
  try {
    const boxes = await selectedCrops(bytes, question, all), crops = [];
    for (const box of boxes) crops.push(await sharp(bytes, options).rotate().extract(box).resize({ width: 2400, withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true }));
    const width = Math.max(...crops.map(c => c.info.width)), height = crops.reduce((sum, c) => sum + c.info.height, 0) + 24 * (crops.length - 1);
    if (width * height > 32_000_000 || height > 60000) throw new HttpError(400, '题图组合过长，请使用分片题图逐片复核');
    let top = 0;
    return await sharp({ create: { width, height, channels: 3, background: 'white' } }).composite(crops.map(c => {
      const tile = { input: c.data, left: 0, top }; top += c.info.height + 24; return tile;
    })).jpeg({ quality: 90 }).toBuffer();
  } catch (error) { return cropError(error); }
}
/** Ordered, overlapping readable tiles for vision models and large review exports. No tile is dropped. */
export async function cropQuestionImages(bytes: Uint8Array, question: Question, all: Question[]) {
  try {
    const boxes = await selectedCrops(bytes, question, all), images: Buffer[] = []; let total = 0;
    for (const box of boxes) {
      const crop = await sharp(bytes, options).rotate().extract(box).resize({ width: 1800, withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
      for (let top = 0; top < crop.info.height; top += 2304) {
        const height = Math.min(2400, crop.info.height - top);
        if (images.length >= QUESTION_IMAGE_PARTS_LIMIT) throw new HttpError(400, '完整题图超过24个清晰分片，请拆分题目或分段复核，未截断提交');
        const image = await sharp(crop.data, options).extract({ left: 0, top, width: crop.info.width, height }).jpeg({ quality: 90 }).toBuffer();
        total += image.length;
        if (total > QUESTION_IMAGE_BYTES_LIMIT) throw new HttpError(400, '完整题图超过24MiB，请拆分题目或分段复核，未截断提交');
        images.push(image); if (top + height >= crop.info.height) break;
      }
    }
    return images;
  } catch (error) { return cropError(error); }
}
