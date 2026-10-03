import type { PickResult } from './types';

const pathOrder = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'variant' });

/** Preserve original names/bytes; folder paths determine display order only. */
export function browserFilesResult(files: readonly File[], folder = false): PickResult {
  const ordered = folder ? [...files].sort((a, b) => {
    const left = a.webkitRelativePath || a.name, right = b.webkitRelativePath || b.name;
    return pathOrder.compare(left, right) || left.localeCompare(right);
  }) : [...files];
  return {
    selectedCount: files.length,
    items: ordered.map(file => ({ name: file.name, mimeType: file.type, size: file.size, source: { kind: 'web', file } })),
    failures: [],
  };
}
