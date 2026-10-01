import { Capacitor, registerPlugin } from '@capacitor/core';

const settings = registerPlugin<{ openAppSettings(): Promise<void> }>('AppSettings');
export async function openAppSettings() {
  if (Capacitor.isNativePlatform()) await settings.openAppSettings();
}
export function captureFailure(error: unknown, source: 'camera' | 'gallery') {
  const code = (error as { code?: string } | null)?.code;
  if (['OS-PLUG-CAMR-0006', 'OS-PLUG-CAMR-0020'].includes(code || '')) return null;
  if (code === 'OS-PLUG-CAMR-0003')
    return '系统相机未获允许。可以从相册选图，或在系统设置中检查相机的权限后重试。';
  if (code === 'OS-PLUG-CAMR-0005')
    return '本次选图未获允许。请重新选择要使用的照片；其他功能仍可使用。';
  return source === 'camera'
    ? '未取得照片，可以重新拍照或从相册选择。'
    : '未取得所选照片，请重新选择 JPEG、PNG 或 WebP 图片。';
}
