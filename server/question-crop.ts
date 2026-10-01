import { sharp } from './sharp';
import { HttpError } from './family-backend';
import { questionContext } from '../lib/question-context';
import type { Question } from '../lib/mobile';

// Original bytes never change. Decode and crop in memory; retain no loose images.
export async function cropQuestionImage(
  bytes: Uint8Array,
  question: Question,
  all: Question[],
) {
  const regions = questionContext(question, all).regions;
  if (!regions.some((r) => r.kind === 'stem'))
    throw new HttpError(400, '请先框出题干');
  try {
    const image = sharp(bytes, {
      limitInputPixels: 32_000_000,
      failOn: 'error',
    });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || (metadata.pages || 1) > 1)
      throw new Error('Unsupported image');
    const swapped = (metadata.orientation || 1) >= 5;
    const width = swapped ? metadata.height : metadata.width,
      height = swapped ? metadata.width : metadata.height;
    const left = Math.max(
      0,
      Math.floor(Math.min(...regions.map((r) => r.x)) * width),
    );
    const top = Math.max(
      0,
      Math.floor(Math.min(...regions.map((r) => r.y)) * height),
    );
    const right = Math.min(
      width,
      Math.ceil(Math.max(...regions.map((r) => r.x + r.width)) * width),
    );
    const bottom = Math.min(
      height,
      Math.ceil(Math.max(...regions.map((r) => r.y + r.height)) * height),
    );
    if (right - left < 8 || bottom - top < 8)
      throw new HttpError(400, '选框太小，请框出完整题目');
    return await image
      .rotate()
      .extract({ left, top, width: right - left, height: bottom - top })
      .resize({
        width: 2400,
        height: 2400,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      400,
      '图片无法裁切或尺寸过大，原件仍保留，请换清晰照片',
    );
  }
}
