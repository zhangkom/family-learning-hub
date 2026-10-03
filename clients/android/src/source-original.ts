import type { FamilyApi } from './api';
import { createCloudApi } from './cloud-drive/api';
import { photoProcessingAvailable, readCloudOriginalUpload } from './photo-processing';
import { getReviewOriginal } from './photo-processing/review-image';
import { decodeQuestionImage } from './question-images';

/** Explicit original-page viewing. Normal question rendering never calls this. */
export async function loadSourceOriginal(api: FamilyApi, owner: string, studentId: string, photoId: string, signal: AbortSignal) {
  const cloud = createCloudApi(api), photo = await cloud.photo(photoId, studentId, signal);
  signal.throwIfAborted();
  let file: Blob | undefined;
  if (photoProcessingAvailable()) {
    try {
      const original = await getReviewOriginal(owner, photo.clientRequestId, signal);
      signal.throwIfAborted();
      if (original.studentId === studentId && original.sha256 === photo.sha256 && original.bytes === photo.size)
        file = (await readCloudOriginalUpload(owner, original, signal)).file;
    } catch { signal.throwIfAborted(); /* A missing local original can be viewed from the archive on this explicit request. */ }
  }
  file ??= await cloud.blob(photo, true, signal);
  signal.throwIfAborted();
  return decodeQuestionImage(file, signal);
}
