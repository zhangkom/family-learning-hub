import { describe, expect, it } from 'vitest';
import { MAX_SCAN_BYTES, sanitizeDisplayName, validateScanFile } from './upload-security';

describe('scan upload validation', () => {
  it('accepts a real PNG signature', async () => {
    const file = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      '错题.png',
      { type: 'image/png' },
    );
    await expect(validateScanFile(file)).resolves.toMatchObject({ ok: true, extension: 'png' });
  });

  it('rejects a file whose declared type does not match its bytes', async () => {
    const file = new File([new TextEncoder().encode('not an image')], 'fake.png', { type: 'image/png' });
    await expect(validateScanFile(file)).resolves.toMatchObject({ ok: false, reason: '文件内容与格式不符' });
  });

  it('rejects files larger than 8 MB before reading them', async () => {
    const file = new File([new Uint8Array(MAX_SCAN_BYTES + 1)], 'large.pdf', { type: 'application/pdf' });
    await expect(validateScanFile(file)).resolves.toMatchObject({ ok: false, reason: '文件不能超过 8 MB' });
  });

  it('removes path fragments and control characters from display names', () => {
    expect(sanitizeDisplayName('..\\家庭/错题\u0000.pdf')).toBe('家庭-错题.pdf');
  });
});
