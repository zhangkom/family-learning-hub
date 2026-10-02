import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getOriginal, listOriginals, previewUrl, readOriginalUpload, type OriginalPhoto } from './index';
import './photo-preparation.css';

export type OriginalExport = Awaited<ReturnType<typeof readOriginalUpload>>;
export type LibraryServices = { list: typeof listOriginals; get: typeof getOriginal; preview: typeof previewUrl; read: typeof readOriginalUpload };
const defaults: LibraryServices = { list: listOriginals, get: getOriginal, preview: previewUrl, read: readOriginalUpload };
export type OriginalPhotoLibraryProps = {
  owner: string; studentId: string; studentLabel?: string; onResume: (original: OriginalPhoto) => void;
  /** Host must implement a real user-selected local save/share destination. Omit until that exists. */
  onExport?: (original: OriginalExport, signal: AbortSignal) => Promise<void>;
  services?: LibraryServices;
};
export function OriginalPhotoLibrary(props: OriginalPhotoLibraryProps) {
  if (!props.owner.trim() || !props.studentId.trim()) return <section className="photo-library">请先选择账号和学生。</section>;
  return <LibrarySession key={JSON.stringify([props.owner, props.studentId])} {...props} />;
}
function LibrarySession({ owner, studentId, studentLabel, onResume, onExport, services = defaults }: OriginalPhotoLibraryProps) {
  const [photos, setPhotos] = useState<OriginalPhoto[]>([]), [total, setTotal] = useState(0), [busy, setBusy] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const life = useRef({ live: true, abort: new AbortController() });
  useLayoutEffect(() => { const current = life.current; current.live = true; current.abort = new AbortController();
    return () => { current.live = false; current.abort.abort(); }; }, []);
  useEffect(() => {
    let current = true;
    void services.list(owner, 0, 30, studentId).then(result => {
      if (current && life.current.live) { assertStudent(result.originals); setPhotos(result.originals); setTotal(result.total); }
    }).catch(e => { if (current && life.current.live) setError(message(e)); }).finally(() => { if (current && life.current.live) setBusy(false); });
    return () => { current = false; };
    // A new keyed session owns every account/student change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, studentId, services]);
  function assertStudent(items: OriginalPhoto[]) { if (items.some(p => p.studentId !== studentId)) throw new Error('原片所属学生不匹配'); }
  function message(e: unknown) { return e instanceof Error ? e.message : '无法读取本机原片，请重试。'; }
  async function loadMore() {
    setBusy(true); setError('');
    try { const result = await services.list(owner, photos.length, 30, studentId);
      if (!life.current.live) return;
      assertStudent(result.originals); setPhotos(previous => [...previous, ...result.originals.filter(p => !previous.some(old => old.originalId === p.originalId))]); setTotal(result.total);
    } catch(e) { if (life.current.live) setError(message(e)); } finally { if (life.current.live) setBusy(false); }
  }
  async function resume(photo: OriginalPhoto) {
    setBusy(true); setError('');
    try { const current = await services.get(owner, photo.originalId); if (!life.current.live) return;
      assertStudent([current]); if (current.originalId !== photo.originalId || current.sha256 !== photo.sha256) throw new Error('原片记录发生变化，请重新打开列表');
      onResume(current);
    } catch(e) { if (life.current.live) setError(message(e)); } finally { if (life.current.live) setBusy(false); }
  }
  async function exportPhoto(photo: OriginalPhoto) {
    if (!onExport) return;
    setBusy(true); setError(''); setNotice('');
    try { const result = await services.read(owner, photo, life.current.abort.signal); if (!life.current.live) return;
      if (result.studentId !== studentId || result.originalId !== photo.originalId) throw new Error('导出原片归属不匹配');
      await onExport(result, life.current.abort.signal);
      if (life.current.live) setNotice('原片已交给所选保存位置。');
    } catch(e) { if (life.current.live) setError(message(e)); } finally { if (life.current.live) setBusy(false); }
  }
  return <section className="photo-library" aria-labelledby="photo-library-title"><header><h2 id="photo-library-title">本机原片</h2><span className="photo-prep-student">{studentLabel || '当前学生'}</span></header>
    <p className="photo-library-note">可重新裁切和调整。本机保存不等于备份，卸载应用或清除应用数据会删除照片。</p>
    {busy && <output>正在读取…</output>}{notice && <output>{notice}</output>}
    {error && <p role="alert" className="photo-prep-error">{error}</p>}
    {!busy && !error && photos.length === 0 && <p>这位学生在本机还没有保存的原片。</p>}
    <div className="photo-library-list">{photos.map(photo => <article key={photo.originalId} className="photo-library-card">
      <img src={services.preview(photo)} alt="原片缩略图" /><div><time dateTime={new Date(photo.createdAt).toISOString()}>{new Date(photo.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</time>
        <p>{photo.uprightWidth} × {photo.uprightHeight} · {(photo.bytes / 1024 / 1024).toFixed(1)} MiB</p>
        <div className="photo-prep-row"><button type="button" disabled={busy} onClick={() => void resume(photo)}>继续处理</button>
          {onExport && <button type="button" disabled={busy} onClick={() => void exportPhoto(photo)}>导出原片</button>}</div></div></article>)}</div>
    {(photos.length < total || error) && <button type="button" disabled={busy} onClick={() => void loadMore()}>{error ? '重试读取' : '加载更多'}</button>}
  </section>;
}
