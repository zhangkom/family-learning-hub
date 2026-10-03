import { describe, expect, it, vi } from 'vitest';
import { readReviewImages } from '../scripts/prism-review-images.mjs';
const image = (bytes = [1, 2]) => new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/jpeg' } });
describe('desktop complete image downloads', () => {
  it('downloads every advertised part in order, without using the old small combined image', async () => {
    const request = vi.fn(async (path: string) => path.endsWith('/images') ? Response.json({ parts: [{ index: 0, size: 2 }, { index: 1, size: 2 }] }) : image(path.endsWith('=0') ? [1, 2] : [3, 4]));
    const result = await readReviewImages(request, 'item', 1);
    expect(result.map(item => item.name)).toEqual(['item.part-01.jpg', 'item.part-02.jpg']);
    expect(result.map(item => [...item.bytes])).toEqual([[1, 2], [3, 4]]);
    expect(request.mock.calls.map(([path]) => path)).toEqual(['items/item/images', 'items/item/image?part=0', 'items/item/image?part=1']);
  });
  it('uses the legacy image endpoint only when the service does not advertise parts', async () => {
    const request = vi.fn(async () => image()); expect((await readReviewImages(request, 'old', undefined))[0].name).toBe('old.jpg');
    expect(request.mock.calls).toEqual([['items/old/image']]);
  });
  it('never returns a partial success or falls back to one image after a part fails', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/images')) return Response.json({ parts: [{ index: 0, size: 2 }, { index: 1, size: 2 }] });
      if (path.endsWith('=1')) throw new Error('synthetic network interruption'); return image();
    });
    await expect(readReviewImages(request, 'item', 1)).rejects.toThrow('interruption'); expect(request).toHaveBeenCalledTimes(3);
  });
  it('rejects invalid, truncated and oversized image manifests or streams', async () => {
    await expect(readReviewImages(async () => Response.json({ parts: Array.from({ length: 25 }, (_, index) => ({ index, size: 2 })) }), 'item', 1)).rejects.toThrow('清单');
    await expect(readReviewImages(async path => path.endsWith('/images') ? Response.json({ parts: [{ index: 0, size: 3 }] }) : image(), 'item', 1)).rejects.toThrow('不完整');
    await expect(readReviewImages(async path => path.endsWith('/images') ? Response.json({ parts: [{ index: 0, size: 1 }] }) : image(), 'item', 1)).rejects.toThrow('超过');
  });
});
