import { expect, it, vi } from 'vitest';
import { ImageRequestGate, retryBusy } from './scheduler';
it('serializes 30 thumbnail jobs, prioritizes uploads and skips aborted waiters', async () => {
  const gate = new ImageRequestGate(), signal = new AbortController().signal, order: string[] = [];
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  const first = gate.run(async () => { order.push('first'); await hold; }, signal);
  const thumbnails = Array.from({ length: 30 }, (_, i) => gate.run(async () => { order.push(`thumb-${i}`); }, signal));
  const stop = new AbortController(); const cancelled = gate.run(async () => { order.push('unexpected'); }, stop.signal).catch(() => {}); stop.abort();
  const upload = gate.run(async () => { order.push('upload'); }, signal, 1); release();
  await Promise.all([first, ...thumbnails, cancelled, upload]); expect(order[1]).toBe('upload'); expect(order).toHaveLength(32); expect(order).not.toContain('unexpected');
});
it('bounds busy retries at 3 and never retries 401', async () => {
  vi.useFakeTimers();
  try {
    const busy = vi.fn().mockRejectedValue({ status: 503 });
    const result = retryBusy(busy, new AbortController().signal).catch(e => e);
    await vi.runAllTimersAsync(); expect(await result).toEqual({ status: 503 }); expect(busy).toHaveBeenCalledTimes(3);
    const auth = vi.fn().mockRejectedValue({ status: 401 }); await expect(retryBusy(auth, new AbortController().signal)).rejects.toEqual({ status: 401 }); expect(auth).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
