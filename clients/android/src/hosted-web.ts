/** Hosted browser builds share the application, but never use Android bearer credentials. */
export const isHostedWeb = import.meta.env.VITE_FAMILY_WEB === 'true';
export const webSessionMarker = 'web-cookie';

export function hostedAppPath(path = '/') {
  const base = (import.meta.env.VITE_WEB_BASE_PATH || '/family-learning').replace(/\/$/, '');
  return `${base}${path}`;
}
export function hostedApiBase() {
  return `${window.location.origin}${hostedAppPath('/api/family/workspace')}`;
}
export function apiAuthentication(base: string, token: string): { credentials: RequestCredentials; headers: Record<string, string> } {
  if (isHostedWeb) {
    if (base !== hostedApiBase()) throw new Error('网页版只连接本站家庭服务，请刷新页面重试');
    return { credentials: 'same-origin', headers: {} };
  }
  return { credentials: 'omit', headers: token ? { Authorization: `Bearer ${token}` } : {} };
}
