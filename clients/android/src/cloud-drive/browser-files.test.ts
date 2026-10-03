import { describe, expect, it } from 'vitest';
import { browserFilesResult } from './browser-files';

function file(name: string, path = '', type = 'image/jpeg') {
  const result = new File(['synthetic-image'], name, { type });
  Object.defineProperty(result, 'webkitRelativePath', { value: path });
  return result;
}

describe('browser cloud selection', () => {
  it('sorts folder selections naturally by relative path and retains each original filename and file', () => {
    const a = file('10.jpg', '作业/第2份/10.jpg'), b = file('2.jpg', '作业/第2份/2.jpg');
    const c = file('2.jpg', '作业/第10份/2.jpg'), d = file('1.jpg', '作业/第2份/1.jpg');
    const files = [c, a, d, b], result = browserFilesResult(files, true);
    expect(result.items.map(item => item.source.kind === 'web' && item.source.file)).toEqual([d, b, a, c]);
    expect(result.items.map(item => item.name)).toEqual(['1.jpg', '2.jpg', '10.jpg', '2.jpg']);
    expect(files).toEqual([c, a, d, b]);
  });
  it('preserves the system selection order outside the folder picker', () => {
    const files = [file('10.jpg'), file('2.jpg')];
    expect(browserFilesResult(files).items.map(item => item.name)).toEqual(['10.jpg', '2.jpg']);
  });
  it('retains all 501 files and leaves MIME and size validation to server-provided limits', () => {
    const files = Array.from({ length: 501 }, (_, i) => file(`${i}.jpg`, `作业/${i}.jpg`));
    files.push(file('说明.txt', '作业/说明.txt', 'text/plain'));
    const result = browserFilesResult(files, true);
    expect(result.selectedCount).toBe(502);
    expect(result.items).toHaveLength(502);
    expect(result.items.find(item => item.name === '说明.txt')?.mimeType).toBe('text/plain');
  });
  it('returns no pending selection on cancel', () => {
    expect(browserFilesResult([], true)).toEqual({ selectedCount: 0, items: [], failures: [] });
  });
});
