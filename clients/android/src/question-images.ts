import type { Scan } from './types';

export type QuestionImage = { url: string; width: number; height: number };
export type QuestionImageState = { status: 'loading' } | { status: 'ready'; image: QuestionImage } | { status: 'error'; message: string };
type Listener = (state: QuestionImageState) => void;
type Entry = { scan: Scan; listeners: Set<Listener>; state: QuestionImageState; abort?: AbortController; cloud: boolean; queued: boolean };
type Loader = (scan: Scan, cloud: boolean, signal: AbortSignal) => Promise<QuestionImage>;

/** One store per account/student view. Only nearby cards hold decoded photos. */
export class QuestionImages {
  private entries = new Map<string, Entry>();
  private active = 0;
  private disposed = false;
  constructor(private readonly loader: Loader, private readonly revoke = (image: QuestionImage) => URL.revokeObjectURL(image.url)) {}
  subscribe(scan: Scan, listener: Listener) {
    if (this.disposed) return () => {};
    let entry = this.entries.get(scan.id);
    if (!entry) {
      entry = { scan, listeners: new Set(), state: { status: 'loading' }, cloud: false, queued: true };
      this.entries.set(scan.id, entry);
    }
    entry.listeners.add(listener); listener(entry.state); this.pump();
    return () => {
      entry.listeners.delete(listener);
      if (!entry.listeners.size && entry.state.status === 'loading') this.remove(scan.id, entry);
      this.trim();
    };
  }
  retry(scanId: string, cloud = false) {
    const entry = this.entries.get(scanId);
    if (!entry || entry.state.status !== 'error' || this.disposed) return;
    entry.cloud = cloud; entry.state = { status: 'loading' }; entry.queued = true;
    this.emit(entry); this.pump();
  }
  imageFailed(scanId: string) {
    const entry = this.entries.get(scanId);
    if (!entry || entry.state.status !== 'ready' || this.disposed) return;
    this.revoke(entry.state.image);
    entry.state = { status: 'error', message: '题图显示失败，请重新读取本机照片' };
    this.emit(entry);
  }
  dispose() {
    this.disposed = true;
    for (const [key, entry] of this.entries) this.remove(key, entry);
  }
  private emit(entry: Entry) { for (const listener of entry.listeners) listener(entry.state); }
  private remove(key: string, entry: Entry) {
    entry.abort?.abort();
    if (entry.state.status === 'ready') this.revoke(entry.state.image);
    if (this.entries.get(key) === entry) this.entries.delete(key);
  }
  private trim() {
    const idle = [...this.entries].filter(([, entry]) => !entry.listeners.size);
    for (const [key, entry] of idle.slice(0, Math.max(0, idle.length - 2))) this.remove(key, entry);
  }
  private pump() {
    if (this.disposed) return;
    for (const [key, entry] of this.entries) {
      // PhotoProcessing has one native worker and rejects overlapping reads as PHOTO_BUSY.
      if (this.active >= 1) break;
      if (!entry.queued || !entry.listeners.size) continue;
      entry.queued = false; const abort = new AbortController(); entry.abort = abort; this.active++;
      void this.loader(entry.scan, entry.cloud, abort.signal).then(image => {
        if (abort.signal.aborted || this.disposed || this.entries.get(key) !== entry) { this.revoke(image); return; }
        entry.state = { status: 'ready', image }; this.emit(entry);
      }).catch((error: unknown) => {
        if (abort.signal.aborted || this.disposed || this.entries.get(key) !== entry) return;
        entry.state = { status: 'error', message: error instanceof Error ? error.message : '题图暂时无法读取' }; this.emit(entry);
      }).finally(() => { this.active--; entry.abort = undefined; this.trim(); this.pump(); });
    }
  }
}

export async function decodeQuestionImage(file: Blob, signal: AbortSignal): Promise<QuestionImage> {
  signal.throwIfAborted();
  const url = URL.createObjectURL(file);
  const image = new Image();
  let cancel: (() => void) | undefined;
  try {
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancel = () => { image.src = ''; reject(signal.reason || new DOMException('Aborted', 'AbortError')); };
      signal.addEventListener('abort', cancel, { once: true });
    });
    image.src = url; await Promise.race([image.decode(), cancelled]); signal.throwIfAborted();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('题图尺寸无法读取');
    return { url, width: image.naturalWidth, height: image.naturalHeight };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
  finally { if (cancel) signal.removeEventListener('abort', cancel); }
}
