/** Durable handoff across Camera activity/process restoration. No image bytes or credentials in WebView storage. */
export type CameraContext = { id: string; owner: string; studentId: string; source: 'camera' | 'gallery' };
export type CameraResult = CameraContext & { uri?: string; webPath?: string };
const activeKey = 'family-learning:pending-camera';
const resultPrefix = 'family-learning:camera-result-v1:';
export const cameraResultEvent = 'family-learning:camera-result-ready';
function valid(context: CameraContext) {
  if (!context || typeof context.id !== 'string' || !context.id || typeof context.owner !== 'string' || !context.owner ||
      typeof context.studentId !== 'string' || !context.studentId || !['camera', 'gallery'].includes(context.source))
    throw new Error('上次拍照的归属记录无效，请重新选择照片');
  return context;
}
export function activeCamera(storage: Storage = localStorage): CameraContext | null {
  const raw = storage.getItem(activeKey);
  return raw ? valid(JSON.parse(raw)) : null;
}
export function beginCamera(owner: string, studentId: string, source: CameraContext['source'], storage: Storage = localStorage) {
  if (activeCamera(storage)) throw new Error('上次相机操作尚未结束，请先处理或取消该操作');
  const context = valid({ id: crypto.randomUUID(), owner, studentId, source });
  storage.setItem(activeKey, JSON.stringify(context));
  return context;
}
export function cancelCamera(context: CameraContext, storage: Storage = localStorage) {
  if (activeCamera(storage)?.id === context.id) storage.removeItem(activeKey);
}
/** Explicit user action, also usable for old-version contexts without a request ID. Does not remove saved results/originals. */
export function clearUnfinishedCamera(owner: string, storage: Storage = localStorage) {
  const raw = storage.getItem(activeKey);
  if (!raw) return;
  const context = JSON.parse(raw) as { owner?: string };
  if (context.owner !== owner) throw new Error('该相机操作属于另一个账号，请返回原账号处理');
  storage.removeItem(activeKey);
}
export function stageCamera(context: CameraContext, data: { uri?: string; webPath?: string; results?: { uri?: string; webPath?: string }[] }, storage: Storage = localStorage) {
  valid(context);
  const first = data.results?.[0] || data;
  if (!first.uri && !first.webPath) throw new Error('相机未返回照片地址，请重试');
  const result: CameraResult = { ...context, uri: first.uri, webPath: first.webPath };
  storage.setItem(resultPrefix + context.id, JSON.stringify(result));
  cancelCamera(context, storage);
  return result;
}
export function restoredCamera(event: { pluginId: string; methodName?: string; success: boolean; data?: unknown }, storage: Storage = localStorage) {
  if (event.pluginId !== 'Camera') return null;
  const context = activeCamera(storage);
  if (!context) return null;
  if (event.methodName && event.methodName !== (context.source === 'camera' ? 'takePhoto' : 'chooseFromGallery'))
    throw new Error('恢复的相机操作与本机记录不匹配，请重新选择照片');
  if (!event.success) { cancelCamera(context, storage); return null; }
  const data = event.data as Parameters<typeof stageCamera>[1];
  if (context.source === 'gallery' && Array.isArray(data?.results)) {
    if (data.results.length > 100) throw new Error('恢复的相册选择超过 100 张，请重新选择');
    if (!data.results.length) { cancelCamera(context, storage); return null; }
    // Persist every reference before the active activity context is removed.
    const staged = data.results.map((photo, index) => {
      if (!photo.uri && !photo.webPath) throw new Error('相册未返回照片地址，请重新选择');
      return { ...context, id: index ? `${context.id}-${index}` : context.id, uri: photo.uri, webPath: photo.webPath };
    });
    for (const result of staged) storage.setItem(resultPrefix + result.id, JSON.stringify(result));
    cancelCamera(context, storage); return staged[0];
  }
  return stageCamera(context, data, storage);
}
export function listCameraResults(owner: string, studentId: string, storage: Storage = localStorage): { results: CameraResult[]; issues: string[] } {
  const results: CameraResult[] = [];
  const issues: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i); if (!key?.startsWith(resultPrefix)) continue;
    let result: CameraResult;
    try { result = JSON.parse(storage.getItem(key) || 'null') as CameraResult; }
    catch { issues.push('有一份相机记录无法确认归属，未导入；请重新拍照或选择原照片。'); continue; }
    if (result?.owner && result.owner !== owner) continue;
    if (result?.studentId && result.studentId !== studentId) continue;
    try { valid(result); if ((!result.uri && !result.webPath) || key !== resultPrefix + result.id) throw new Error('invalid photo reference'); results.push(result); }
    catch { issues.push('有一份相机记录无法确认归属或照片地址，未导入；请重新拍照或选择原照片。'); }
  }
  return { results, issues };
}
export function removeCameraResult(result: CameraResult, storage: Storage = localStorage) {
  const key = resultPrefix + result.id, saved = storage.getItem(key);
  if (saved) { const current = JSON.parse(saved) as CameraResult;
    if (current.id !== result.id || current.owner !== result.owner || current.studentId !== result.studentId) throw new Error('相机结果归属不匹配');
    storage.removeItem(key);
  }
}
