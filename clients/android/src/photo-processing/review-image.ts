import { Capacitor } from '@capacitor/core';
import type { FamilyApi } from '../api';
import type { Scan } from '../types';
import { getOriginal, readConfirmedUpload } from './index';

/** Use the exact local processed version so saved question coordinates still match. Never silently download on Android. */
export async function loadReviewImage(api: FamilyApi, owner: string, scan: Pick<Scan, 'id' | 'studentId' | 'sourceKind' | 'processing'>, allowCloud: boolean, signal: AbortSignal) {
  signal.throwIfAborted();
  if (Capacitor.getPlatform() !== 'android' || allowCloud) return { file: await api.image(scan.id, signal), source: 'cloud' as const };
  const processing = scan.processing;
  if (scan.sourceKind !== 'processed-photo' || !processing || processing.studentId !== scan.studentId)
    throw new Error('这张题图暂时没有可用的本机记录');
  const original = await getOriginal(owner, processing.originalId);
  signal.throwIfAborted();
  if (original.studentId !== scan.studentId || original.sha256 !== processing.sourceSha256 || original.uprightWidth !== processing.sourceWidth || original.uprightHeight !== processing.sourceHeight)
    throw new Error('本机照片与当前题图不匹配');
  const uri = original.originalUri.slice(0, original.originalUri.lastIndexOf('/') + 1) + processing.outputId + '.jpg';
  // Reads only the private local file and verifies its bytes/hash; no upload is performed.
  const result = await readConfirmedUpload({ ...processing, uri }, true, signal);
  return { file: result.file, source: 'local' as const };
}
