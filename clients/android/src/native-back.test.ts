import { afterEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ callbacks: [] as (() => void)[], remove: vi.fn(async () => {}) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn((_name: string, callback: () => void) => { native.callbacks.push(callback); return Promise.resolve({ remove: native.remove }); }) } }));
import { registerNativeBack } from './native-back';
const cleanups: (() => void)[] = [];
afterEach(async () => { cleanups.splice(0).forEach(cleanup => cleanup()); await Promise.resolve(); native.callbacks.length = 0; vi.clearAllMocks(); });
describe('native question viewer back routing', () => {
  it('closes the viewer without also leaving its source details', () => {
    const details = vi.fn(), viewer = vi.fn();
    cleanups.push(registerNativeBack(details)); cleanups.push(registerNativeBack(viewer, 100));
    expect(native.callbacks).toHaveLength(1); native.callbacks[0]();
    expect(viewer).toHaveBeenCalledOnce(); expect(details).not.toHaveBeenCalled();
  });
  it('returns to the parent handler after dismissing the viewer', () => {
    const details = vi.fn(), viewer = vi.fn();
    cleanups.push(registerNativeBack(details)); const close = registerNativeBack(viewer, 100); cleanups.push(close);
    native.callbacks[0](); close(); native.callbacks[0]();
    expect(viewer).toHaveBeenCalledOnce(); expect(details).toHaveBeenCalledOnce();
  });
  it('ignores an old account listener even if native removal has not settled', () => {
    const first = vi.fn(), second = vi.fn();
    const old = registerNativeBack(first); cleanups.push(old); const oldEvent = native.callbacks[0]; old();
    cleanups.push(registerNativeBack(second)); oldEvent(); native.callbacks[1]();
    expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce();
  });
  it('selects the latest equally-prioritized view and tolerates repeated cleanup', () => {
    const first = vi.fn(), latest = vi.fn(); cleanups.push(registerNativeBack(first));
    const close = registerNativeBack(latest); cleanups.push(close); native.callbacks[0]();
    close(); close(); native.callbacks[0](); expect(first).toHaveBeenCalledOnce(); expect(latest).toHaveBeenCalledOnce();
  });
});
