import { useEffect, useState } from 'react';
import type { FamilyApi } from './api';
import type { QuestionImage } from './question-images';
import type { Scan, SourcePage } from './types';
import { loadSourceOriginal } from './source-original';
import { sourcePageLabel } from './source-location';
import { QuestionImageViewer } from './QuestionImageViewer';

export function SourceOriginals({ api, owner, scan, source }: { api: FamilyApi; owner: string; scan: Scan; source: SourcePage }) {
  const parts = [...new Map([{ photoId: source.photoId, title: source.title, paperPageNumber: source.paperPageNumber, pageRole: source.pageRole, originalName: scan.originalName }, ...(source.sourceParts || [])].map(part => [part.photoId, part])).values()];
  const [selected, setSelected] = useState<{ id: string; label: string; attempt: number }>();
  const [state, setState] = useState<{ image?: QuestionImage; error?: string }>({});
  useEffect(() => {
    if (!selected) return;
    const abort = new AbortController(); let image: QuestionImage | undefined;
    setState({});
    void loadSourceOriginal(api, owner, scan.studentId, selected.id, abort.signal).then(result => {
      if (abort.signal.aborted) { URL.revokeObjectURL(result.url); return; }
      image = result; setState({ image });
    }).catch(error => { if (!abort.signal.aborted) setState({ error: (error as Error).message || '原件读取失败，请重试' }); });
    return () => { abort.abort(); if (image) URL.revokeObjectURL(image.url); };
  }, [api, owner, scan.studentId, selected]);
  return <div className="source-originals">
    <p>查看整张原件（优先本机；缺失时仅读取所点原页）</p>
    {parts.map(part => { const label = `${part.title || source.title} · ${part.paperPageNumber || part.photoId === source.photoId ? sourcePageLabel({ pageNumber: source.pageNumber, paperPageNumber: part.paperPageNumber, pageRole: part.pageRole }) : '页码待核对'}`; return <button type="button" key={part.photoId} disabled={!!selected} onClick={() => { setState({}); setSelected({ id: part.photoId, label, attempt: 0 }); }}>查看整张原件 · {label}{parts.length > 1 && part.originalName ? ` · ${part.originalName}` : ''}</button>; })}
    {selected && !state.image && <div className="source-original-status" aria-live="polite"><p>{state.error || '正在读取来源原件…'}</p>{state.error && <button type="button" onClick={() => { setState({}); setSelected({ ...selected, attempt: selected.attempt + 1 }); }}>重试读取原件</button>}<button type="button" onClick={() => { setSelected(undefined); setState({}); }}>{state.error ? '收起' : '取消读取'}</button></div>}
    {selected && state.image && <QuestionImageViewer image={state.image} rectangles={[{ id: 'whole-original', x: 0, y: 0, width: 1, height: 1 }]} number="" title={`来源原件 · ${selected.label}`} onClose={() => { setSelected(undefined); setState({}); }} onImageError={() => setState({ error: '原件显示失败，请重试读取' })} />}
  </div>;
}
