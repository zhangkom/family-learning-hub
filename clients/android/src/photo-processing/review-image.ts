import { Capacitor } from '@capacitor/core';
import type { FamilyApi } from '../api';
import type { Scan } from '../types';
import { getOriginal, readConfirmedUpload } from './index';

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
export async function loadReviewImage(api: FamilyApi, owner: string, scan: Pick<Scan, 'id' | 'studentId' | 'sourceKind' | 'processing'>, allowCloud: boolean, signal: AbortSignal) {
  signal.throwIfAborted();
  if (Capacitor.getPlatform() !== 'android' || allowCloud) return { file: await api.image(scan.id, signal), source: 'cloud' as const };
  const processing = scan.processing;
  if (scan.sourceKind !== 'processed-photo' || !processing || processing.studentId !== scan.studentId)
    throw new Error('这张题图暂时没有可用的本机记录');
  const original = await getReviewOriginal(owner, processing.originalId, signal);
  signal.throwIfAborted();
  if (original.studentId !== scan.studentId || original.sha256 !== processing.sourceSha256 || original.uprightWidth !== processing.sourceWidth || original.uprightHeight !== processing.sourceHeight)
    throw new Error('本机照片与当前题图不匹配');
  const uri = original.originalUri.slice(0, original.originalUri.lastIndexOf('/') + 1) + processing.outputId + '.jpg';
  // Reads only the private local file and verifies its bytes/hash; no upload is performed.
  const result = await readConfirmedUpload({ ...processing, uri }, true, signal);
  return { file: result.file, source: 'local' as const };
}
