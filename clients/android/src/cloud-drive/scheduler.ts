/** Serializes thumbnail work with uploads; uploads take priority over not-yet-started previews. */
export class ImageRequestGate {
  private active = false;
  private waiting: { priority: number; signal: AbortSignal; execute: () => Promise<void>; cancel: () => void }[] = [];
  run<T>(task: () => Promise<T>, signal: AbortSignal, priority = 0): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
      const item = { priority, signal, execute: async () => {
        signal.removeEventListener('abort', item.cancel);
        try { signal.throwIfAborted(); resolve(await task()); } catch (e) { reject(e); }
      }, cancel: () => { this.waiting = this.waiting.filter(other => other !== item); reject(signal.reason); } };
      signal.addEventListener('abort', item.cancel, { once: true }); this.waiting.push(item); this.drain();
    });
  }
  private drain() {
    if (this.active) return;
    this.waiting.sort((a, b) => b.priority - a.priority);
    const item = this.waiting.shift(); if (!item) return;
    this.active = true;
    void item.execute().finally(() => { this.active = false; this.drain(); });
  }
}
export async function retryBusy<T>(task: () => Promise<T>, signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { return await task(); }
    catch (error) {
      if (signal.aborted || attempt >= 2 || !error || typeof error !== 'object' || !('status' in error) || ![429, 503].includes(Number(error.status))) throw error;
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 300 * (attempt + 1));
        signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
      });
    }
  }
}
