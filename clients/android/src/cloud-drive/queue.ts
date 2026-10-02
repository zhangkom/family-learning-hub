import { assertReceipt, assertScope, inScope, type CloudScope, type DriveServices, type DriveStore, type PickedOriginal, type UploadJob, type UploadBytes } from './types';

export type QueueSnapshot = { jobs: UploadJob[]; running: boolean; phase?: 'naming' | 'reading' | 'sending'; activeId?: string; error?: string };
/** One original in memory at a time. Starting is always an explicit user action. */
export class UploadQueue {
  private state: QueueSnapshot = { jobs: [], running: false };
  private subscribers = new Set<() => void>();
  private controller?: AbortController;
  private live = true;
  private loaded = false;
  private adding = false;
  constructor(readonly scope: CloudScope, private store: DriveStore, private services: Pick<DriveServices, 'read' | 'upload' | 'prepare'>) { assertScope(scope); }
  snapshot = () => this.state;
  subscribe = (callback: () => void) => { this.subscribers.add(callback); return () => { this.subscribers.delete(callback); }; };
  private set(patch: Partial<QueueSnapshot>) { this.state = { ...this.state, ...patch }; if (this.live) for (const cb of this.subscribers) cb(); }
  async load() {
    const saved = await this.store.list(this.scope);
    if (!this.live) return;
    this.set({ jobs: saved.filter(job => inScope(job, this.scope)).map(job => job.status === 'uploading' ? { ...job, status: 'paused', message: '上次上传未确认完成，继续时将核对同一份记录' } : job) });
    this.loaded = true;
  }
  async add(items: PickedOriginal[], newSelection = true) {
    if (!this.live || !this.loaded || this.state.running || this.adding) throw new Error('请等待当前操作完成');
    const known = new Set(this.state.jobs.map(job => job.id));
    const additions = items.filter(item => { if (!item.id) return true; if (known.has(item.id)) return false; known.add(item.id); return true; });
    this.adding = true;
    try {
      if (newSelection && additions.length && this.state.jobs.length && this.state.jobs.every(job => job.status === 'completed')) {
        // Start a fresh visible total. Cloud receipts and original files are retained.
        for (const completed of this.state.jobs) await this.store.remove(this.scope, completed.id);
        this.set({ jobs: [] });
      }
      const clientBatchId = crypto.randomUUID();
      for (const item of additions) {
        if (!this.live) break;
        const expectedCount = additions.length;
        const job: UploadJob = { ...this.scope, ...item, id: item.id || crypto.randomUUID(), clientBatchId, expectedCount, createdAt: Date.now(), status: 'queued' };
        if (item.source.kind === 'native' && item.source.original.studentId !== this.scope.studentId) throw new Error('原图所属孩子不匹配');
        await this.store.put(job);
        this.set({ jobs: [...this.state.jobs, job] });
      }
      return additions.length;
    } finally { this.adding = false; }
  }
  private async save(job: UploadJob) {
    if (!inScope(job, this.scope)) throw new Error('上传记录归属不匹配');
    await this.store.put(job);
    this.set({ jobs: this.state.jobs.map(row => row.id === job.id ? job : row) });
  }
  async start(onlyId?: string) {
    if (!this.live || !this.loaded || this.state.running || this.adding) return;
    this.controller = new AbortController(); const controller = this.controller;
    const candidates = this.state.jobs.filter(job => job.status !== 'completed' && (!onlyId || job.id === onlyId));
    this.set({ running: true, error: undefined });
    try {
      for (const original of candidates) {
        if (!this.live || controller.signal.aborted) break;
        let job: UploadJob = { ...original, status: 'uploading', message: undefined };
        try {
          let bytes: UploadBytes | undefined;
          for (;;) {
            controller.signal.throwIfAborted();
            this.set({ activeId: job.id, phase: 'naming' });
            if (this.services.prepare) job = await this.services.prepare(job, controller.signal);
            await this.save(job);
            controller.signal.throwIfAborted();
            this.set({ activeId: job.id, phase: 'reading' });
            bytes ??= await this.services.read(job, controller.signal);
            controller.signal.throwIfAborted();
            if (bytes.file.size !== job.size || bytes.file.type !== job.mimeType || !/^[a-f\d]{64}$/.test(bytes.sha256) || (job.sha256 && bytes.sha256 !== job.sha256))
              throw new Error('本机原图已变化，请重新选择；原上传记录保留');
            job = { ...job, sha256: bytes.sha256 }; await this.save(job);
            controller.signal.throwIfAborted(); this.set({ phase: 'sending' });
            let receipt;
            try { receipt = await this.services.upload(job, bytes, controller.signal); }
            catch (error) {
              if (this.services.prepare && error && typeof error === 'object' && 'code' in error && error.code === 'CLOUD_NAME_CONFLICT') {
                job = { ...job, nameToken: undefined }; continue;
              }
              throw error;
            }
            assertReceipt(receipt, job, bytes.sha256);
            // A verified acknowledgement remains completed even if Stop was pressed as it arrived.
            await this.save({ ...job, status: 'completed', receipt, source: job.source.kind === 'web' ? { kind: 'web' } : job.source });
            break;
          }
        } catch (e) {
          const stopped = controller.signal.aborted || !this.live;
          await this.save({ ...job, status: stopped ? 'paused' : 'failed', message: stopped ? '已停止；继续时会核对是否已上传' : e instanceof Error ? e.message : '上传未完成，请重试' });
          // Authentication loss must not keep sending later files under an expired session.
          if (e && typeof e === 'object' && 'status' in e && e.status === 401) controller.abort();
        }
      }
    } catch (e) { this.set({ error: e instanceof Error ? e.message : '保存上传状态失败，请重新打开核对' }); }
    finally { this.set({ running: false, phase: undefined, activeId: undefined }); }
  }
  stop() { this.controller?.abort(); }
  async remove(id: string) {
    if (this.state.running || this.adding) throw new Error('请先停止上传');
    await this.store.remove(this.scope, id); this.set({ jobs: this.state.jobs.filter(job => job.id !== id) });
  }
  dispose() { this.live = false; this.stop(); this.subscribers.clear(); }
}
