import { Capacitor, registerPlugin } from '@capacitor/core';
import { validateMatrix, validateQuad, type Quad, type Matrix3 } from './geometry';
export { fullPage, mapPoint, mapQuestionToOriginal, pointerToImage } from './geometry';
export type { Quad, Matrix3 } from './geometry';

export type OriginalPhoto = {
  schemaVersion: 1; originalId: string; studentId: string; sha256: string; bytes: number;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number; height: number; orientation: number; uprightWidth: number; uprightHeight: number;
  originalUri: string; previewUri: string; createdAt: number;
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
  listOriginals(input: { owner: string; offset: number; limit: number }): Promise<{ originals: OriginalPhoto[]; total: number }>;
  process(input: { owner: string; originalId: string } & ProcessOptions): Promise<PreparedPhoto>;
  deleteOriginal(input: { owner: string; originalId: string; confirmDelete: true }): Promise<void>;
}
const native = registerPlugin<NativePhotos>('PhotoProcessing');
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
function validateOriginal(photo: OriginalPhoto) {
  if (photo.schemaVersion !== 1 || !uuid.test(photo.originalId) || !hash.test(photo.sha256) ||
    typeof photo.studentId !== 'string' || !photo.studentId.trim() || photo.studentId.length > 200 ||
    !Number.isSafeInteger(photo.bytes) || photo.bytes <= 0 || photo.bytes > 32 * 1024 * 1024 ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(photo.mime) ||
    !Number.isInteger(photo.orientation) || photo.orientation < 1 || photo.orientation > 8 ||
    ![photo.width, photo.height, photo.uprightWidth, photo.uprightHeight].every((v) => Number.isInteger(v) && v > 0))
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
export async function listOriginals(owner: string, offset = 0, limit = 30) {
  requireNative(owner);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('原片列表范围无效');
  const result = await native.listOriginals({ owner, offset, limit });
  result.originals.forEach(validateOriginal);
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
    ![photo.width, photo.height].every((v) => Number.isInteger(v) && v >= 16 && v <= 4096))
    throw new Error('处理结果无效');
  validateQuad(photo.corners); validateMatrix(photo.sourceToOutput); validateMatrix(photo.outputToSource); localFile(photo.uri);
}

/** Caller must show the prepared image first. Does not upload or delete the original. */
export async function readConfirmedUpload(photo: PreparedPhoto, confirmed: boolean): Promise<{ file: Blob; name: string; processing: Omit<PreparedPhoto, 'uri'> }> {
  if (confirmed !== true) throw new Error('请先预览并确认处理后的照片');
  validatePrepared(photo);
  if (!photoProcessingAvailable()) throw new Error('本地照片处理尚未接入');
  const response = await fetch(Capacitor.convertFileSrc(photo.uri), { credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error('无法读取处理后的照片');
  const blob = await response.blob();
  if (blob.size !== photo.bytes) throw new Error('处理图片大小不匹配，请重新生成');
  const bytes = await blob.arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
  if (digest !== photo.sha256) throw new Error('处理图片校验失败，请重新生成');
  const { uri: _localUri, ...processing } = photo;
  return { file: new Blob([bytes], { type: 'image/jpeg' }), name: `题图-${photo.outputId}.jpg`, processing };
}
export async function deleteOriginal(owner: string, originalId: string, confirmed: boolean) {
  requireNative(owner, originalId);
  if (confirmed !== true) throw new Error('删除本机原片需要确认');
  await native.deleteOriginal({ owner, originalId, confirmDelete: true });
}
