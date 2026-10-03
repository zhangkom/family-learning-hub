import { Capacitor } from '@capacitor/core';
import type { FamilyApi } from '../api';
import { getOriginal, readConfirmedUpload } from './index';
import { recoveredImages, type ImageScan } from './recovered-image';
import { decodeQuestionImage } from '../question-images';
import { questionImageHash } from '../question-image-identity';

function waitForPhotoWorker(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(signal.reason || new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, 250);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

export async function getReviewOriginal(owner: string, originalId: string, signal: AbortSignal) {
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

/** Use the exact local image first. Question views allow recovery; local-only callers can still pass false. */
export async function loadReviewImage(api: FamilyApi, owner: string, scan: ImageScan, allowCloud: boolean, signal: AbortSignal) {
  signal.throwIfAborted();
  if (Capacitor.getPlatform() !== 'android') {
    const file = await api.image(scan.id, signal, scan.sourcePage?.scanSha256, scan.imageRevision);
    if (questionImageHash(scan)) await recoveredImages.verify(scan, file, signal);
    return { file, source: 'cloud' as const };
  }
  recoveredImages.validate(owner, scan);
  const processing = scan.processing;
  if (processing && processing.studentId !== scan.studentId) throw new Error('题图学生归属不匹配，请刷新题目');
  let localError: unknown = new Error('当前手机尚未保存这张题图，请点击恢复；恢复后保存在本机');
  if (scan.sourceKind === 'processed-photo' && processing && processing.sha256 === questionImageHash(scan)) {
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
  // Recovery is bounded and cancelable. Persist exact bytes before reporting success.
  const recovery = new AbortController();
  const abort = () => recovery.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => recovery.abort(new Error('题图恢复超时，请检查网络后重试')), 45000);
  try {
    signal.throwIfAborted();
    const file = await api.image(scan.id, recovery.signal, scan.sourcePage?.scanSha256, scan.imageRevision);
    const decoded = await decodeQuestionImage(file, recovery.signal); URL.revokeObjectURL(decoded.url);
    recovery.signal.throwIfAborted();
    await recoveredImages.save(owner, scan, file, recovery.signal);
    return { file, source: 'local' as const };
  } catch (error) {
    signal.throwIfAborted();
    if (recovery.signal.aborted) throw recovery.signal.reason;
    if (error instanceof TypeError) throw new Error('无法连接题图服务，请检查网络后重试');
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
