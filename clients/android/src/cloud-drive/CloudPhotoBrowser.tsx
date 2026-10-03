import { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, ChevronRight } from 'lucide-react';
import { ApiError } from '../api';
import { sourcePageLabel } from '../source-location';
import type { CloudDocumentFolder, CloudFolders, CloudPage, CloudPhoto, DriveServices } from './types';

type Path = { subject?: string; document?: CloudDocumentFolder; unclassified?: boolean };
const sizeLabel = (size: number) => size >= 1048576 ? `${(size / 1048576).toFixed(1)} MiB` : `${Math.ceil(size / 1024)} KiB`;
export function CloudPhotoBrowser({ services, studentId, archiveEnabled, refreshKey, onView, onDownload, downloading, onStorage }: {
  services: DriveServices; studentId: string; archiveEnabled: boolean; refreshKey: number;
  onView: (photo: CloudPhoto) => void; onDownload: (photo: CloudPhoto) => void; downloading: string;
  onStorage: (storage: CloudPage['storage']) => void;
}) {
  const [path, setPath] = useState<Path>({}), [legacy, setLegacy] = useState(!archiveEnabled || !services.folders);
  const [folders, setFolders] = useState<CloudFolders>({}), [page, setPage] = useState<CloudPage>({ photos: [] });
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null), ticket = useRef(0);
  const load = useCallback(async (cursor?: string) => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const request = ++ticket.current; setLoading(true); setError('');
    if (!cursor) { setPage({ photos: [] }); setFolders({}); }
    try {
      let showPhotos = legacy || !!path.document || !!path.unclassified;
      if (!showPhotos && services.folders) {
        try {
          const next = await services.folders(studentId, path.subject, cursor, abort.signal);
          if (abort.signal.aborted || request !== ticket.current) return;
          setFolders(previous => ({ ...next, documents: cursor ? [...(previous.documents || []), ...(next.documents || []).filter(doc => !previous.documents?.some(old => old.id === doc.id))] : next.documents }));
        } catch (e) {
          if (!(e instanceof ApiError) || ![404, 405, 501].includes(e.status)) throw e;
          setLegacy(true); setPath({}); showPhotos = true;
        }
      }
      if (showPhotos) {
        const next = await services.list(studentId, cursor, abort.signal, legacy ? undefined : { documentId: path.document?.id, unclassified: path.unclassified });
        if (abort.signal.aborted || request !== ticket.current) return;
        setPage(previous => ({ ...next, photos: cursor ? [...previous.photos, ...next.photos.filter(photo => !previous.photos.some(old => old.id === photo.id))] : next.photos }));
        onStorage(next.storage);
      }
    } catch (e) { if (!abort.signal.aborted && request === ticket.current) setError(e instanceof Error ? e.message : '云图读取未完成'); }
    finally { if (!abort.signal.aborted && request === ticket.current) setLoading(false); }
  }, [legacy, onStorage, path, services, studentId]);
  const cancel = useCallback(() => { controller.current?.abort(); ticket.current++; }, []);
  useEffect(() => { void load(); return cancel; }, [load, refreshKey, cancel]);
  const showPhotos = legacy || !!path.document || !!path.unclassified;
  const cursor = showPhotos ? page.nextCursor : folders.nextCursor;
  const title = path.document?.title || (path.unclassified ? '待整理' : path.subject || '已存云图');
  return <section className="cloud-panel cloud-archive" aria-labelledby="cloud-photos-title">
    <div className="cloud-section-heading"><h3 id="cloud-photos-title">{title}</h3><button type="button" disabled={loading} onClick={() => void load()}>刷新</button></div>
    {!legacy && <nav className="cloud-breadcrumbs" aria-label="云盘文件夹"><button disabled={!path.subject && !path.unclassified} onClick={() => setPath({})}>全部科目</button>
      {path.subject && <><ChevronRight size={14} /><button disabled={!path.document} onClick={() => setPath({ subject: path.subject })}>{path.subject}</button></>}
      {(path.document || path.unclassified) && <><ChevronRight size={14} /><span aria-current="page">{path.document?.title || '待整理'}</span></>}
    </nav>}
    {path.document && <p className="cloud-hint">共 {path.document.pageCount} 张原图 · 按作业页序排列</p>}
    {path.unclassified && <p className="cloud-hint">科目或作业归属尚未确认的原图。</p>}
    {page.storage && <p className="cloud-hint">家庭云盘已用 {sizeLabel(page.storage.usedBytes)} / {sizeLabel(page.storage.limitBytes)}</p>}
    {!showPhotos && <div className="cloud-folder-grid">
      {folders.subjects?.map(subject => <button key={subject.subject} type="button" className="cloud-folder" onClick={() => setPath({ subject: subject.subject })}><Folder size={27} /><span><strong>{subject.subject}</strong><small>{subject.documentCount} 份作业 · {subject.photoCount} 张</small></span><ChevronRight size={17} /></button>)}
      {!!folders.unclassifiedCount && <button type="button" className="cloud-folder cloud-folder-pending" onClick={() => setPath({ unclassified: true })}><Folder size={27} /><span><strong>待整理</strong><small>{folders.unclassifiedCount} 张原图</small></span><ChevronRight size={17} /></button>}
      {folders.documents?.map(document => <button key={document.id} type="button" className="cloud-folder" onClick={() => setPath({ subject: path.subject, document })}><Folder size={27} /><span><strong>{document.title}</strong><small>{document.pageCount} 张原图</small></span><ChevronRight size={17} /></button>)}
    </div>}
    {showPhotos && <div className="cloud-grid">{page.photos.map(photo => <article className="cloud-photo" key={photo.id}>
      <button type="button" className="cloud-photo-open" onClick={() => onView(photo)} aria-label={`预览 ${photo.originalName}`}><PrivatePreview photo={photo} services={services} />{photo.archive && <b className="cloud-page-number">{sourcePageLabel(photo.archive)}</b>}<span>{photo.originalName}</span></button>
      <div className="cloud-photo-meta"><time>{new Date(photo.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}</time><span>{sizeLabel(photo.size)}</span></div>
      <button type="button" disabled={!!downloading} onClick={() => onDownload(photo)}>{downloading === photo.id ? '正在保存…' : '下载原图'}</button>
    </article>)}</div>}
    {error && <p role="alert" className="cloud-error">{error}。可点“刷新”重试。</p>}
    {loading && <output className="cloud-empty">正在读取{showPhotos ? '云图' : '作业目录'}…</output>}
    {!loading && !error && (showPhotos ? !page.photos.length : !folders.subjects?.length && !folders.documents?.length && !folders.unclassifiedCount) && <p className="cloud-empty">{path.document ? '这份作业暂未找到原页，请返回刷新目录。' : path.unclassified ? '全部原图已整理。' : path.subject ? '这个科目暂时没有作业。' : '还没有云图。上传完成后会出现在这里。'}</p>}
    {cursor && <button type="button" disabled={loading} onClick={() => void load(cursor || undefined)}>加载更多</button>}
  </section>;
}

export function PrivatePreview({ photo, services }: { photo: CloudPhoto; services: DriveServices }) {
  const [url, setUrl] = useState(''), [failed, setFailed] = useState(false), element = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const abort = new AbortController(); let objectUrl = '', started = false;
    setUrl(''); setFailed(false);
    const load = async () => {
      if (started) return; started = true;
      try { const file = await services.preview(photo, abort.signal); if (abort.signal.aborted) return; objectUrl = URL.createObjectURL(file); setUrl(objectUrl); }
      catch { if (!abort.signal.aborted) setFailed(true); }
    };
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void load(); } }, { rootMargin: '100px' });
    if (element.current) observer.observe(element.current);
    return () => { abort.abort(); observer.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photo, services]);
  return <span ref={element} className="cloud-thumbnail">{url ? <img src={url} alt={photo.originalName} /> : <span>{failed ? '预览暂不可用' : '图片预览'}</span>}</span>;
}
