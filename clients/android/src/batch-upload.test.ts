import { expect, it } from 'vitest';
import { runPhotoBatch } from './batch-upload';

it('sends 100 files sequentially and retains independent failures for retry', async () => {
  let active = 0, peak = 0; const sent: string[] = [];
  const result = await runPhotoBatch(Array.from({ length: 100 }, (_, n) => ({ id: `${n}` })), async item => {
    active++; peak = Math.max(peak, active); await Promise.resolve(); active--; sent.push(item.id);
    if (item.id === '30') throw new Error('网络断开');
  }, new AbortController().signal, () => {});
  expect(peak).toBe(1); expect(sent).toHaveLength(100); expect(result).toMatchObject({ completed: 100, succeeded: 99, failed: [{ id: '30', reason: '网络断开' }] });
});
it('stops before sending further photos when cancelled', async () => {
  const abort = new AbortController(), sent: string[] = [];
  const result = await runPhotoBatch([{ id: 'a' }, { id: 'b' }], async item => { sent.push(item.id); abort.abort(); }, abort.signal, () => {});
  expect(sent).toEqual(['a']); expect(result).toMatchObject({ succeeded: 1, stopped: true, completed: 1 });
});
it('does not call interrupted files successful or start the next request', async () => {
  const abort = new AbortController(); let sent = 0;
  const result = await runPhotoBatch([{ id: 'a' }, { id: 'b' }], async () => { sent++; abort.abort(); throw new Error('abort'); }, abort.signal, () => {});
  expect(sent).toBe(1); expect(result).toMatchObject({ succeeded: 0, stopped: true, completed: 0 });
});
it('rejects empty, duplicate or over-limit batches before reading a photo', async () => {
  for (const items of [[], [{ id: 'a' }, { id: 'a' }], Array.from({ length: 101 }, (_, n) => ({ id: `${n}` }))]) {
    await expect(runPhotoBatch(items, async () => { throw new Error('should not run'); }, new AbortController().signal, () => {})).rejects.toThrow('100');
  }
});
