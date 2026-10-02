import { useEffect, useState } from 'react';
import { previewUrl, type OriginalPhoto } from './photo-processing/public';
import type { Draft } from './drafts';
import './capture-batch.css';

export type CaptureCollection = { studentId: string; originals: OriginalPhoto[]; drafts: Draft[]; nativeBatchIds?: string[] };
export const collectionSize = (collection: CaptureCollection) => collection.originals.length + collection.drafts.length;

function DraftThumbnail({ draft }: { draft: Draft }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(draft.file); setUrl(next); return () => URL.revokeObjectURL(next); }, [draft.file]);
  return <img src={url || undefined} alt={draft.name} loading="lazy" />;
}

export function CaptureBatch({ collection, studentLabel, busy, error, progress, onCapture, onFolderRange, onRemove, onFinish, onClose }: {
  collection: CaptureCollection; studentLabel: string; busy: boolean; error: string; progress?: string;
  onCapture: (source: 'camera' | 'gallery') => void; onRemove: (id: string) => void; onFinish: () => void; onClose: () => void;
  onFolderRange?: () => void;
}) {
  const count = collectionSize(collection);
  return <main className="capture-batch">
    <div className="section-line"><div><span className="eyebrow">{studentLabel} · 拍题收集</span><h1>已选 {count} 张</h1></div>
      <button disabled={busy} onClick={onClose}>返回题目资料</button></div>
    <p>可连续拍摄或从相册多选，也可继续添加。照片先保存在本机，确认后再上传。</p>
    <div className="capture-batch-actions">
      <button className="primary" disabled={busy} onClick={() => onCapture('camera')}>继续拍照</button>
      <button disabled={busy} onClick={() => onCapture('gallery')}>从相册添加</button>
      {onFolderRange && <button disabled={busy} onClick={onFolderRange}>按文件夹选范围 / 全选</button>}
      <button className="primary" disabled={busy || !count} onClick={onFinish}>{collection.originals.length ? '完成选择，逐张调整' : '完成选择，查看待上传'}</button>
    </div>
    {busy && <output>{progress || '正在保存照片，请稍候…'}</output>}
    {error && <p role="alert" className="error">{error}</p>}
    {!count && !busy && <p className="hint">尚未添加照片。取消拍摄后，也可以继续添加。</p>}
    <div className="capture-batch-grid">
      {collection.originals.map((photo, index) => <article key={photo.originalId}>
        <img src={previewUrl(photo)} alt={`本批第 ${index + 1} 张照片`} loading="lazy" />
        <span>{photo.originalName || `第 ${index + 1} 张`} · {(photo.bytes / 1024 / 1024).toFixed(1)} MB</span>
        <button disabled={busy} onClick={() => onRemove(photo.originalId)}>移出本批</button>
      </article>)}
      {collection.drafts.map(draft => <article key={draft.id}><DraftThumbnail draft={draft} /><span>{draft.name}</span>
        <button disabled={busy} onClick={() => onRemove(draft.id)}>移出本批</button></article>)}
    </div>
    <p className="hint">移出本批的照片不会随本批上传，手机原片仍保留。返回时，其他已选照片保留在本机。</p>
  </main>;
}
