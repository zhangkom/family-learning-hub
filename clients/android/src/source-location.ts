import type { SourcePage } from './types';

export function sourcePageLabel(source: Pick<SourcePage, 'pageNumber' | 'paperPageNumber' | 'pageRole' | 'duplicateOfPhotoId'>) {
  const page = source.paperPageNumber ?? source.pageNumber;
  const unit = source.pageRole && !source.paperPageNumber ? '张' : '页';
  return `${source.pageRole === 'answer-sheet' ? '答题卡 · ' : ''}第 ${page} ${unit}${source.duplicateOfPhotoId ? ' · 重复原件' : ''}`;
}
