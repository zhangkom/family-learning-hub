import { Capacitor } from '@capacitor/core';
import { photoPlugin } from './native-plugin';
import { originalPhotoName } from './original-name';
export { originalPhotoName } from './original-name';
import { validateMatrix, validateQuad, type Quad, type Matrix3 } from './geometry';
export { fullPage, mapPoint, mapQuestionToOriginal, pointerToImage } from './geometry';
export type { Quad, Matrix3 } from './geometry';

export type OriginalPhoto = {
  schemaVersion: 1; originalId: string; studentId: string; sha256: string; bytes: number;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number; height: number; orientation: number; uprightWidth: number; uprightHeight: number;
  originalUri: string; previewUri: string; createdAt: number; originalName?: string;
};
export type ProcessOptions = {
  /** EXIF-upright source coordinates; NEVER coordinates from the rotated result preview. */
  corners?: Quad; quarterTurns?: 0 | 1 | 2 | 3;
  enhancement?: 'none' | 'light'; maxEdge?: number; jpegQuality?: number;
};
export type PhotoQuality = {
  advisoryOnly: true;
  warnings: ('low-light' | 'low-contrast-or-blank' | 'uneven-light-or-colored-background' | 'possible-blur' | 'small-output')[];
  laplacianVariance: number; darkFraction: number; backgroundRange: number; percentile10: number; percentile90: number;
};
export type PreparedPhoto = {
  schemaVersion: 1; algorithmVersion: 'android-photo-v1'; originalId: string; studentId: string; outputId: string;
  sourceSha256: string; sha256: string; bytes: number; mime: 'image/jpeg'; width: number; height: number;
  sourceWidth: number; sourceHeight: number; exifOrientation: number; decodedWidth: number; decodedHeight: number;
  sourceSpace: 'exif-upright-normalized-edges'; outputSpace: 'normalized-edges';
  corners: Quad; quarterTurns: number; enhancement: 'none' | 'light'; jpegQuality: number; maxEdge: number;
  sourceToOutput: Matrix3; outputToSource: Matrix3; quality: PhotoQuality; createdAt: number; uri: string;
};
interface NativePhotos {
  importPhoto(input: { owner: string; uri: string; studentId: string }): Promise<OriginalPhoto>;
  getOriginal(input: { owner: string; originalId: string }): Promise<OriginalPhoto>;
  listOriginals(input: { owner: string; offset: number; limit: number; studentId?: string }): Promise<{ originals: OriginalPhoto[]; total: number }>;
  process(input: { owner: string; originalId: string } & ProcessOptions): Promise<PreparedPhoto>;
  deleteOriginal(input: { owner: string; originalId: string; confirmDelete: true }): Promise<void>;
}
const native = photoPlugin<NativePhotos>();
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/;
const hash = /^[a-f\d]{64}$/;

export function photoProcessingAvailable() {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('PhotoProcessing');
}
function requireNative(owner: string, originalId?: string) {
  if (!photoProcessingAvailable()) throw new Error('此设备尚未接入本地照片处理，请使用现有拍照上传流程');
  if (typeof owner !== 'string' || !owner.trim() || owner.length > 1024) throw new Error('未指定照片所属账号');
  if (originalId !== undefined && !uuid.test(originalId)) throw new Error('原片编号无效');
}
function localFile(uri: string) {
  if (typeof uri !== 'string' || !uri.startsWith('file:///') || uri.includes('\0')) throw new Error('返回的本机文件地址无效');
  return uri;
}
export function validateOriginal(photo: OriginalPhoto) {
  if (photo.schemaVersion !== 1 || !uuid.test(photo.originalId) || !hash.test(photo.sha256) ||
    typeof photo.studentId !== 'string' || !photo.studentId.trim() || photo.studentId.length > 200 ||
    !Number.isSafeInteger(photo.bytes) || photo.bytes <= 0 || photo.bytes > 32 * 1024 * 1024 ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(photo.mime) ||
    !Number.isInteger(photo.orientation) || photo.orientation < 1 || photo.orientation > 8 ||
    !Number.isFinite(photo.createdAt) || photo.createdAt <= 0 ||
    (photo.originalName !== undefined && (typeof photo.originalName !== 'string' || !photo.originalName || photo.originalName.length > 1024 || Array.from(photo.originalName).some(c => c === '/' || c === '\\' || c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))) ||
    ![photo.width, photo.height, photo.uprightWidth, photo.uprightHeight].every((v) => Number.isInteger(v) && v > 0 && v <= 50000))
    throw new Error('本机原片记录无效');
  localFile(photo.originalUri); localFile(photo.previewUri);
  return photo;
}
export function previewUrl(photo: OriginalPhoto | PreparedPhoto) {
  return Capacitor.convertFileSrc(localFile('previewUri' in photo ? photo.previewUri : photo.uri));
}
export async function importOriginal(owner: string, uri: string, studentId: string): Promise<OriginalPhoto> {
  requireNative(owner);
  if (typeof studentId !== 'string' || !studentId.trim() || studentId.length > 200) throw new Error('请先选择学生');
  // Capacitor Camera 8.x can return an absolute filesystem path without file://.
  // Native code still confines file access to this app's private/cache directories.
  if (typeof uri !== 'string' || !(/^(content|file):\/\//.test(uri) || /^\/(?!\/)/.test(uri)))
    throw new Error('请传入相机或相册返回的原生 uri');
  const result = validateOriginal(await native.importPhoto({ owner, uri, studentId }));
  if (result.studentId !== studentId) throw new Error('原片学生归属不匹配');
  return result;
}
export async function getOriginal(owner: string, originalId: string) {
  requireNative(owner, originalId);
  const result = validateOriginal(await native.getOriginal({ owner, originalId }));
  if (result.originalId !== originalId) throw new Error('原片编号不匹配');
  return result;
}
export async function listOriginals(owner: string, offset = 0, limit = 30, studentId?: string) {
  requireNative(owner);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('原片列表范围无效');
  if (studentId !== undefined && (!studentId.trim() || studentId.length > 200)) throw new Error('请先选择学生');
  const result = await native.listOriginals({ owner, offset, limit, studentId });
  result.originals.forEach(validateOriginal);
  if (studentId !== undefined && result.originals.some(p => p.studentId !== studentId)) throw new Error('原片学生归属不匹配');
  return result;
}
export async function preparePhoto(owner: string, original: OriginalPhoto, options: ProcessOptions = {}) {
  requireNative(owner, original.originalId); validateOriginal(original);
  if (options.corners) validateQuad(options.corners);
  if (options.quarterTurns !== undefined && ![0, 1, 2, 3].includes(options.quarterTurns)) throw new Error('旋转次数无效');
  if (options.enhancement !== undefined && !['none', 'light'].includes(options.enhancement)) throw new Error('增强模式无效');
  for (const [value, min, max] of [[options.maxEdge, 256, 4096], [options.jpegQuality, 90, 100]]) {
    if (value !== undefined && (!Number.isInteger(value) || value < min! || value > max!)) throw new Error('处理参数超出范围');
  }
  const result = await native.process({ owner, originalId: original.originalId,
    corners: options.corners, quarterTurns: options.quarterTurns, enhancement: options.enhancement,
    maxEdge: options.maxEdge, jpegQuality: options.jpegQuality });
  validatePrepared(result);
  if (result.originalId !== original.originalId || result.sourceSha256 !== original.sha256 || result.studentId !== original.studentId)
    throw new Error('处理结果与原片不匹配');
  return result;
}
export function validatePrepared(photo: PreparedPhoto) {
  if (photo.schemaVersion !== 1 || photo.algorithmVersion !== 'android-photo-v1' ||
    typeof photo.studentId !== 'string' || !photo.studentId.trim() || photo.studentId.length > 200 ||
    !uuid.test(photo.originalId) || !uuid.test(photo.outputId) || !hash.test(photo.sourceSha256) || !hash.test(photo.sha256) ||
    photo.mime !== 'image/jpeg' || photo.sourceSpace !== 'exif-upright-normalized-edges' || photo.outputSpace !== 'normalized-edges' ||
    !Number.isSafeInteger(photo.bytes) || photo.bytes < 1 || photo.bytes > 8 * 1024 * 1024 ||
    ![0, 1, 2, 3].includes(photo.quarterTurns) || !['none', 'light'].includes(photo.enhancement) ||
    !Number.isInteger(photo.jpegQuality) || photo.jpegQuality < 90 || photo.jpegQuality > 100 ||
    !Number.isInteger(photo.maxEdge) || photo.maxEdge < 256 || photo.maxEdge > 4096 ||
    !Number.isFinite(photo.createdAt) || photo.createdAt <= 0 ||
    !photo.quality || photo.quality.advisoryOnly !== true || !Array.isArray(photo.quality.warnings) ||
    photo.quality.warnings.some(code => !['low-light', 'low-contrast-or-blank', 'uneven-light-or-colored-background', 'possible-blur', 'small-output'].includes(code)) ||
    ![photo.width, photo.height].every((v) => Number.isInteger(v) && v >= 16 && v <= 4096))
    throw new Error('处理结果无效');
  validateQuad(photo.corners); validateMatrix(photo.sourceToOutput); validateMatrix(photo.outputToSource); localFile(photo.uri);
}

/** Caller must show the prepared image first. Does not upload or delete the original. */
export async function readConfirmedUpload(photo: PreparedPhoto, confirmed: boolean, signal?: AbortSignal): Promise<{ file: Blob; name: string; processing: Omit<PreparedPhoto, 'uri'> }> {
  if (confirmed !== true) throw new Error('请先预览并确认处理后的照片');
  validatePrepared(photo);
  if (!photoProcessingAvailable()) throw new Error('本地照片处理尚未接入');
  const file = await readVerifiedFile(photo.uri, photo.bytes, photo.sha256, photo.mime, signal);
  const { uri: _localUri, ...processing } = photo;
  return { file, name: `题图-${photo.outputId}.jpg`, processing };
}

async function readVerifiedFile(uri: string, size: number, sha: string, mime: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const response = await fetch(Capacitor.convertFileSrc(localFile(uri)), { credentials: 'omit', redirect: 'error', signal });
  if (!response.ok) throw new Error('无法读取本机照片');
  const blob = await response.blob();
  if (blob.size !== size) throw new Error('图片大小不匹配，请重新读取');
  const bytes = await blob.arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
  signal?.throwIfAborted();
  if (digest !== sha) throw new Error('图片校验失败，请重新读取');
  return new Blob([bytes], { type: mime });
}

/** Optional export/transport capability. The normal upload flow NEVER calls this. No re-encoding. */
export async function readOriginalUpload(owner: string, original: OriginalPhoto, signal?: AbortSignal) {
  signal?.throwIfAborted(); validateOriginal(original);
  const current = await getOriginal(owner, original.originalId);
  if (current.sha256 !== original.sha256 || current.studentId !== original.studentId) throw new Error('原片归属或内容已变化');
  const file = await readVerifiedFile(current.originalUri, current.bytes, current.sha256, current.mime, signal);
  return { file, name: originalPhotoName(current), originalId: current.originalId,
    studentId: current.studentId, sha256: current.sha256, mime: current.mime, bytes: current.bytes,
    uploadEligibility: { status: current.bytes > 8 * 1024 * 1024 ? 'exceeds-current-limit' as const : 'within-current-limit' as const,
      maxBytes: 8 * 1024 * 1024 } };
}
export async function deleteOriginal(owner: string, originalId: string, confirmed: boolean) {
  requireNative(owner, originalId);
  if (confirmed !== true) throw new Error('删除本机原片需要确认');
  await native.deleteOriginal({ owner, originalId, confirmDelete: true });
}

/** Explicit cloud-original flow. No processing, re-encoding, or legacy 8 MiB scan limit. */
export async function readCloudOriginalUpload(owner: string, original: OriginalPhoto, signal?: AbortSignal) {
  const { uploadEligibility: _legacyScanLimit, ...result } = await readOriginalUpload(owner, original, signal);
  return result;
}
export * from './batch';
export * from './cloud-download';
