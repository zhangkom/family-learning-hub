export const MAX_SCAN_BYTES = 8 * 1024 * 1024;

const extensions = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
} as const;

type AllowedMime = keyof typeof extensions;

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function hasValidSignature(mime: AllowedMime, bytes: Uint8Array) {
  if (mime === 'image/jpeg') return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (mime === 'image/png') return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mime === 'application/pdf') return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50]);
}

export function sanitizeDisplayName(name: string) {
  return Array.from(name)
    .filter((character) => { const code = character.charCodeAt(0); return code > 31 && code !== 127; })
    .join('')
    .replace(/[\\/]+/g, '-')
    .replace(/^[.\s-]+/g, '')
    .slice(0, 120) || '未命名扫描件';
}

export async function validateScanFile(file: File) {
  if (file.size > MAX_SCAN_BYTES) return { ok: false as const, reason: '文件不能超过 8 MB' };
  if (!(file.type in extensions)) return { ok: false as const, reason: '只支持 JPG、PNG、WebP 或 PDF' };

  const mime = file.type as AllowedMime;
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!hasValidSignature(mime, bytes)) return { ok: false as const, reason: '文件内容与格式不符' };

  return { ok: true as const, mime, extension: extensions[mime] };
}
