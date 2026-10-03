import { ApiError, FamilyApi, validateServer } from './api';
import { session } from './session';
import type { User } from './types';
import { hostedApiBase, isHostedWeb, webSessionMarker } from './hosted-web';

export type Auth = { base: string; token: string; user: User; capabilities?: { admin: boolean; adminPasswordChangeRequired?: boolean } };

export async function restoreSession(
  vault: Pick<typeof session, 'read' | 'clear'> = session,
  lookup = (base: string, token: string) => new FamilyApi(base, token).me(),
): Promise<Auth | null> {
  if (isHostedWeb) {
    const base = hostedApiBase();
    try { const result = await new FamilyApi(base).me(); return { base, token: webSessionMarker, ...result }; }
    catch (error) { if (error instanceof ApiError && error.status === 401) return null; throw error; }
  }
  const stored = await vault.read();
  if (!stored) return null;
  let base: string, token: string;
  try {
    const value = JSON.parse(stored);
    if (typeof value.base !== 'string' || typeof value.token !== 'string' || !value.token)
      throw new Error('Invalid stored session');
    base = validateServer(value.base);
    token = value.token;
  } catch {
    await vault.clear();
    throw new ApiError('登录资料已失效，请重新登录', 401);
  }
  try {
    const { user } = await lookup(base, token);
    return { base, token, user };
  } catch (error) {
    // A timeout, offline device, or unavailable server must not erase the login.
    if (error instanceof ApiError && error.status === 401) await vault.clear();
    throw error;
  }
}
