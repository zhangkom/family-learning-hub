export type BatchProgress = { total: number; completed: number; succeeded: number; failed: { id: string; reason: string }[]; stopped: boolean };

/** Hold only one photo's upload bytes at a time; an unacknowledged item remains in its durable queue. */
export async function runPhotoBatch<T extends { id: string }>(items: readonly T[], send: (item: T, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal, report: (progress: BatchProgress) => void): Promise<BatchProgress> {
  if (!items.length || new Set(items.map(item => item.id)).size !== items.length)
    throw new Error('请选择至少一张不同的照片');
  const progress: BatchProgress = { total: items.length, completed: 0, succeeded: 0, failed: [], stopped: false };
  const emit = () => report({ ...progress, failed: [...progress.failed] });
  emit();
  groups: for (let offset = 0; offset < items.length; offset += 200) {
   for (const item of items.slice(offset, offset + 200)) {
    if (signal.aborted) { progress.stopped = true; break groups; }
    try { await send(item, signal); progress.succeeded++; }
    catch (error) {
      if (signal.aborted) { progress.stopped = true; break groups; }
      progress.failed.push({ id: item.id, reason: error instanceof Error ? error.message : '上传未完成' });
    }
    progress.completed++; emit();
  }
  }
  emit(); return progress;
}
