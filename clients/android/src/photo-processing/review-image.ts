import { Capacitor } from '@capacitor/core';
import type { FamilyApi } from '../api';
import { getOriginal, readConfirmedUpload } from './index';
import { recoveredImages, type ImageScan } from './recovered-image';
import { decodeQuestionImage } from '../question-images';

function waitForPhotoWorker(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(signal.reason || new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, 250);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

async function getReviewOriginal(owner: string, originalId: string, signal: AbortSignal) {
  // The native photo worker is shared with the home page's recovery/list reads.
  // Retry only its explicit transient busy response, never a missing/corrupt file.
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { return await getOriginal(owner, originalId); }
    catch (error) {
      const busy = error && typeof error === 'object' && 'code' in error && error.code === 'PHOTO_BUSY';
      if (!busy || attempt >= 11) throw error;
      await waitForPhotoWorker(signal);
    }
  }
}

/** Use the exact local processed version so saved question coordinates still match. Never silently download on Android. */
export async function loadReviewImage(api: FamilyApi, owner: string, scan: ImageScan, allowCloud: boolean, signal: AbortSignal) {
  signal.throwIfAborted();
  if (Capacitor.getPlatform() !== 'android') return { file: await api.image(scan.id, signal), source: 'cloud' as const };
  recoveredImages.validate(owner, scan);
  const processing = scan.processing;
  if (processing && processing.studentId !== scan.studentId) throw new Error('题图学生归属不匹配，请刷新题目');
  let localError: unknown = new Error('这张题图尚未关联到当前手机，恢复一次后会保存在本机');
  if (scan.sourceKind === 'processed-photo' && processing) {
    try {
      const original = await getReviewOriginal(owner, processing.originalId, signal);
      signal.throwIfAborted();
      if (original.studentId !== scan.studentId || original.sha256 !== processing.sourceSha256 || original.uprightWidth !== processing.sourceWidth || original.uprightHeight !== processing.sourceHeight)
        throw new Error('本机照片与当前题图不匹配');
      const uri = original.originalUri.slice(0, original.originalUri.lastIndexOf('/') + 1) + processing.outputId + '.jpg';
      const result = await readConfirmedUpload({ ...processing, uri }, true, signal);
      return { file: result.file, source: 'local' as const };
    } catch (error) { signal.throwIfAborted(); localError = error; }
  }
  try {
    const file = await recoveredImages.read(owner, scan, signal);
    if (file) return { file, source: 'local' as const };
  } catch (error) { signal.throwIfAborted(); localError = error; }
  if (!allowCloud) throw localError;
  // Explicit recovery only. Save the exact server image, never a recropped/re-encoded original.
  const file = await api.image(scan.id, signal);
  const decoded = await decodeQuestionImage(file, signal); URL.revokeObjectURL(decoded.url);
  signal.throwIfAborted();
  await recoveredImages.save(owner, scan, file, signal);
  return { file, source: 'local' as const };
}
