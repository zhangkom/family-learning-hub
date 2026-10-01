import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { familyWebsite, updateManifestUrl } from './release';

export type Release = {
  version: string;
  versionCode: number;
  downloadUrl: string;
  bytes: number;
  sha256: string;
  notes: string;
  deltas?: Delta[];
};
export type Delta = {
  format: 'zai-copy-v1'; fromVersionCode: number; baseBytes: number; baseSha256: string;
  downloadUrl: string; bytes: number; sha256: string;
};
export type UpdatePhase = 'full' | 'delta' | 'prepare' | 'verify' | 'fallback';

function parseDeltas(value: unknown, targetCode: number, targetBytes: number): Delta[] {
  if (!Array.isArray(value) || value.length > 4) return [];
  return value.flatMap((item: Partial<Delta> | null) => {
    if (!item || item.format !== 'zai-copy-v1' || !Number.isSafeInteger(item.fromVersionCode) ||
      item.fromVersionCode! < 7 || item.fromVersionCode! >= targetCode ||
      !Number.isSafeInteger(item.baseBytes) || item.baseBytes! < 1 || item.baseBytes! > 256 * 1024 * 1024 ||
      !Number.isSafeInteger(item.bytes) || item.bytes! < 1 || item.bytes! > targetBytes * 0.8 || targetBytes - item.bytes! < 65536 ||
      typeof item.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(item.sha256) ||
      typeof item.baseSha256 !== 'string' || !/^[a-f\d]{64}$/i.test(item.baseSha256) ||
      item.downloadUrl !== `${familyWebsite}downloads/android/family-learning-${item.fromVersionCode}-to-${targetCode}-${item.sha256.slice(0, 16).toLowerCase()}.zaidelta.gz`) return [];
    return [{ ...item, sha256: item.sha256.toLowerCase(), baseSha256: item.baseSha256.toLowerCase() } as Delta];
  });
}
export function eligibleDelta(release: Release, installedCode: number) {
  return release.deltas?.find((delta) => delta.fromVersionCode === installedCode);
}

// The manifest is public. Never send a family token or cookies to this endpoint.
export function parseRelease(value: unknown): Release {
  const data = value as Partial<Release> & { channel?: string; changelog?: string };
  if (!data || data.channel !== 'release' ||
    typeof data.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(data.version) ||
    !Number.isSafeInteger(data.versionCode) || data.versionCode! < 1 ||
    !Number.isSafeInteger(data.bytes) || data.bytes! < 1 || data.bytes! > 256 * 1024 * 1024 ||
    typeof data.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(data.sha256) ||
    typeof data.downloadUrl !== 'string') throw new Error('版本信息不完整，请稍后重试');
  const url = new URL(data.downloadUrl);
  const prefix = `${familyWebsite}downloads/android/`;
  if (!url.href.startsWith(prefix) || url.search || url.hash || url.username || url.password ||
    !/^family-learning-\d+\.\d+\.\d+-release-[a-f\d]{7,40}\.apk$/.test(url.href.slice(prefix.length)))
    throw new Error('更新地址无效，请稍后重试');
  return { version: data.version, versionCode: data.versionCode!, downloadUrl: url.href,
    bytes: data.bytes!, sha256: data.sha256.toLowerCase(),
    deltas: parseDeltas(data.deltas, data.versionCode!, data.bytes!),
    notes: typeof data.changelog === 'string' ? data.changelog.slice(0, 2000)
      : typeof data.notes === 'string' ? data.notes.slice(0, 2000) : '改进家庭学习体验。' };
}

export async function checkRelease(): Promise<Release> {
  const response = await fetch(updateManifestUrl, {
    credentials: 'omit', cache: 'no-store', redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('暂时无法检查更新，请稍后重试');
  return parseRelease(await response.json());
}

export const AppUpdater = registerPlugin<{
  download(release: Release): Promise<{ mode: 'full' | 'delta'; fallback: boolean }>;
  install(): Promise<{ permissionRequired: boolean }>;
  openInstallSettings(): Promise<void>;
  addListener(name: 'downloadProgress', listener: (event: { percent: number; phase?: UpdatePhase }) => void): Promise<PluginListenerHandle>;
}>('AppUpdater');
