const MAX_PARTS = 24, MAX_BYTES = 24 * 1024 * 1024;
async function imageBytes(response, maximum) {
  if (!response.headers.get('content-type')?.startsWith('image/jpeg')) throw new Error('题图格式无效');
  if (!response.body) throw new Error('题图内容为空');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new Error('题图超过复核下载范围，未作为完整材料保存'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new Error('题图内容为空');
  return new Uint8Array(Buffer.concat(chunks));
}
/** Fetch the whole bounded set before the caller writes any success material. */
export async function readReviewImages(request, itemId, imagePartsVersion) {
  if (imagePartsVersion !== 1) return [{ name: itemId + '.jpg', bytes: await imageBytes(await request('items/' + itemId + '/image'), 32 * 1024 * 1024) }];
  const manifest = await (await request('items/' + itemId + '/images')).json();
  if (!Array.isArray(manifest.parts) || !manifest.parts.length || manifest.parts.length > MAX_PARTS || manifest.parts.some((part, index) => part.index !== index || !Number.isSafeInteger(part.size) || part.size <= 0) || manifest.parts.reduce((sum, part) => sum + part.size, 0) > MAX_BYTES)
    throw new Error('题图分片清单无效或超限，未作为完整材料保存');
  const images = [];
  for (const part of manifest.parts) {
    const bytes = await imageBytes(await request('items/' + itemId + '/image?part=' + part.index), part.size);
    if (bytes.byteLength !== part.size) throw new Error('题图分片下载不完整，请重新读取整道题');
    images.push({ name: itemId + '.part-' + String(part.index + 1).padStart(2, '0') + '.jpg', bytes });
  }
  return images;
}
