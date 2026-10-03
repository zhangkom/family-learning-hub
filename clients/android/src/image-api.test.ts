import { afterEach, expect, it, vi } from 'vitest';
import { FamilyApi } from './api';

afterEach(() => vi.unstubAllGlobals());
it('selects revision zero explicitly and rejects invalid historical selectors before network access', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new Blob(['image'], { type: 'image/jpeg' }))); vi.stubGlobal('fetch', fetcher);
  const api = new FamilyApi('https://synthetic.invalid', 'synthetic');
  await api.image('scan', undefined, undefined, 0);
  expect(fetcher.mock.calls[0][0]).toBe('https://synthetic.invalid/scans/scan/file?revision=0');
  await expect(api.image('scan', undefined, undefined, -1)).rejects.toThrow('历史版本');
  await expect(api.image('scan', undefined, 'bad')).rejects.toThrow('版本信息');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
