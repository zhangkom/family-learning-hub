import { registerPlugin } from '@capacitor/core';
import { photoProcessingAvailable } from './index';

export type CloudOriginalDownloadOptions = {
  base: string; token: string; path: string; name: string;
  mime: 'image/jpeg' | 'image/png' | 'image/webp'; bytes: number; sha256: string;
};
interface NativeDownload {
  downloadCloudOriginal(input: CloudOriginalDownloadOptions & { requestId: string }): Promise<{ saved: boolean; cancelled: boolean }>;
  cancelCloudOriginalDownload(input: { requestId: string }): Promise<void>;
}
const native = registerPlugin<NativeDownload>('PhotoProcessing');
/** User-initiated native HTTPS stream, verified before Android's save-location dialog. */
export async function downloadCloudOriginal(options: CloudOriginalDownloadOptions, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!photoProcessingAvailable()) throw new Error('当前设备没有接入安卓原图保存，请使用浏览器下载');
  const base = new URL(options.base);
  const production = base.protocol === 'https:' && base.hostname === '123.207.232.151' && !base.port;
  const test = import.meta.env.DEV && base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname);
  if ((!production && !test) || base.username || base.password || base.search || base.hash || base.pathname !== '/family-learning/api/mobile/v1' ||
    !/^\/cloud-photos\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\/file$/.test(options.path)) throw new Error('云盘下载地址不属于本项目');
  if (!Number.isSafeInteger(options.bytes) || options.bytes < 1 || options.bytes > 32 * 1024 * 1024 ||
    !/^[a-f\d]{64}$/.test(options.sha256) || !['image/jpeg', 'image/png', 'image/webp'].includes(options.mime) ||
    !options.token || options.token.length > 16384 || /[^\x21-\x7e]/.test(options.token)) throw new Error('云盘原图信息或登录状态无效');
  const requestId = crypto.randomUUID();
  const abort = () => { void native.cancelCloudOriginalDownload({ requestId }).catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = await native.downloadCloudOriginal({ ...options, requestId });
    if (typeof result.saved !== 'boolean' || typeof result.cancelled !== 'boolean' || result.saved === result.cancelled)
      throw new Error('未取得原图保存结果，请检查系统下载位置');
    return result;
  } finally { signal?.removeEventListener('abort', abort); }
}
