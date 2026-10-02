import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { FamilyApi } from '../api';
import { createDriveServices } from './services';
import { driveStore } from './store';
import { UploadQueue, type QueueSnapshot } from './queue';
import { BATCH_LIMIT, type CloudLimits, type CloudPage, type CloudPhoto, type DriveServices, type DriveStore, type PickResult, type PickedOriginal } from './types';
import './cloud-drive.css';

export type CloudPhotoDriveProps = {
  api: FamilyApi; owner: string; studentId: string; studentLabel?: string; onClose: () => void;
  /** Isolated synthetic QA or a host-specific native adapter. */
  services?: DriveServices; store?: DriveStore;
};
const sizeLabel = (size: number) => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MiB` : `${Math.ceil(size / 1024)} KiB`;
const message = (e: unknown) => e instanceof Error ? e.message : '操作未完成，请重试';
const statusLabel = { queued: '待上传', uploading: '上传中', paused: '已停止', failed: '需重试', completed: '已存云盘' };

export function CloudPhotoDrive(props: CloudPhotoDriveProps) {
  if (!props.owner.trim() || !props.studentId.trim()) return <section className="cloud-drive" role="alert">请先选择账号和孩子。</section>;
  return <DriveSession key={JSON.stringify([props.owner, props.studentId, props.api.base])} {...props} />;
}
function DriveSession({ api, owner, studentId, studentLabel, onClose, services: supplied, store = driveStore }: CloudPhotoDriveProps) {
  const services = useMemo(() => supplied || createDriveServices(api), [api, supplied]);
  const [queue, setQueue] = useState<QueueSnapshot>({ jobs: [], running: false });
  const [ready, setReady] = useState(false), [limits, setLimits] = useState<CloudLimits | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [picking, setPicking] = useState(false);
  const [photos, setPhotos] = useState<CloudPage>({ photos: [] }), [listing, setListing] = useState(false);
  const [viewing, setViewing] = useState<CloudPhoto | null>(null), [downloading, setDownloading] = useState('');
  const [recoveryAction, setRecoveryAction] = useState<{ run: () => Promise<void> } | null>(null);
  const controller = useRef<AbortController | null>(null), queueRef = useRef<UploadQueue | null>(null), input = useRef<HTMLInputElement>(null);
  const live = useRef(false), listTicket = useRef(0), closeRef = useRef<() => void>(() => {});
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; if (viewing && element && !element.open) element.showModal(); return () => element?.close(); }, [viewing]);
  const uploadCount = queue.jobs.filter(job => job.status === 'completed').length;
  const waiting = queue.jobs.length - uploadCount, available = Math.max(0, (limits?.maxBatch || BATCH_LIMIT) - waiting);
  const locked = queue.running || picking || !ready;
  const refresh = useCallback(async (cursor?: string) => {
    const signal = controller.current?.signal; if (!live.current || !signal || signal.aborted) return;
    const ticket = ++listTicket.current; setListing(true);
    try {
      const page = await services.list(studentId, cursor, signal);
      if (!live.current || signal.aborted || ticket !== listTicket.current) return;
      setPhotos(previous => ({ ...page, photos: cursor ? [...previous.photos, ...page.photos.filter(photo => !previous.photos.some(old => old.id === photo.id))] : page.photos }));
    } catch (e) { if (live.current && !signal.aborted && ticket === listTicket.current) setError(message(e)); }
    finally { if (live.current && ticket === listTicket.current) setListing(false); }
  }, [services, studentId]);
  useEffect(() => {
    live.current = true; const abort = new AbortController(); controller.current = abort;
    const work = new UploadQueue({ owner, studentId }, store, services); queueRef.current = work;
    const unsubscribe = work.subscribe(() => { if (live.current && !abort.signal.aborted) setQueue(work.snapshot()); });
    void Promise.all([work.load(), services.limits(abort.signal)]).then(([, cap]) => {
      if (live.current && !abort.signal.aborted) { setLimits(cap); setReady(true); void refresh(); }
    }).catch(e => { if (live.current && !abort.signal.aborted) setError(message(e)); });
    return () => { live.current = false; abort.abort(); work.dispose(); unsubscribe(); };
  }, [owner, studentId, store, services, refresh]);
  function close() { queueRef.current?.stop(); controller.current?.abort(); onClose(); }
  closeRef.current = () => { if (viewing) setViewing(null); else close(); };
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener('backButton', () => closeRef.current());
    return () => { void listener.then(handle => handle.remove()); };
  }, []);
  async function addPicked(result: PickResult) {
    const signal = controller.current?.signal;
    if (!live.current || !signal || signal.aborted || !limits) return;
    const rejected: string[] = [], accepted: PickedOriginal[] = [];
    for (const item of result.items) {
      if (!limits.mimeTypes.includes(item.mimeType)) rejected.push(`${item.name}：暂不支持此格式`);
      else if (item.size > limits.maxFileBytes || item.size < 1) rejected.push(`${item.name}：超过单张大小限制或文件为空`);
      else accepted.push(item);
    }
    if (result.items.length > limits.maxBatch) throw new Error(`一批最多 ${limits.maxBatch} 张，请重新选择`);
    if (accepted.length) await queueRef.current?.add(accepted);
    if (!live.current || signal.aborted) return;
    setRecoveryAction(result.discardRecovery ? { run: result.discardRecovery } : null);
    if (!rejected.length && !result.failures.length) await result.acknowledge?.();
    if (!live.current || signal.aborted) return;
    setNotice(result.cancelled && !accepted.length ? '已取消选图' : accepted.length ? `已保存 ${accepted.length} 张到本机待上传，请点“开始上传”。` : '没有新的图片需要加入');
    setError([...result.failures, ...rejected].join('；'));
  }
  async function select(recover = false) {
    const signal = controller.current?.signal; if (locked || !signal) return;
    setError(''); setNotice('');
    if (!recover && !available) { setError('一批最多 100 张，请先上传或移除待上传图片'); return; }
    if (!services.native && !recover) { input.current?.click(); return; }
    setPicking(true);
    try {
      const result = recover ? await services.recover?.({ owner, studentId }, 100, signal) : await services.pick?.({ owner, studentId }, available, signal);
      if (!result) throw new Error('此设备暂不支持此选图方式');
      await addPicked(result);
    } catch (e) { if (live.current && !signal.aborted) setError(message(e)); }
    finally { if (live.current && !signal.aborted) setPicking(false); }
  }
  async function filesSelected(files: File[]) {
    setPicking(true); setError(''); setNotice('');
    try {
      if (files.length > available) throw new Error(`本批还可加入 ${available} 张，请重新选择`);
      await addPicked({ items: files.map(file => ({ name: file.name, mimeType: file.type, size: file.size, source: { kind: 'web', file } })), failures: [] });
    } catch (e) { if (live.current) setError(message(e)); }
    finally { if (live.current) setPicking(false); }
  }
  async function start(id?: string) {
    if (locked) return; setError(''); setNotice('');
    await queueRef.current?.start(id);
    if (live.current) await refresh();
  }
  async function remove(id: string) {
    try { await queueRef.current?.remove(id); } catch (e) { if (live.current) setError(message(e)); }
  }
  async function download(photo: CloudPhoto) {
    const signal = controller.current?.signal; if (!signal || downloading) return;
    setDownloading(photo.id); setError(''); setNotice('');
    try {
      await services.download(photo, signal);
      if (live.current && !signal.aborted) setNotice(services.native ? '原图已保存到所选位置' : '已交给浏览器下载，请查看下载记录');
    } catch (e) { if (live.current && !signal.aborted) setError(message(e)); }
    finally { if (live.current && !signal.aborted) setDownloading(''); }
  }
  async function discardRecovery() {
    if (!recoveryAction || locked) return; setPicking(true);
    try { await recoveryAction.run(); if (live.current) { setRecoveryAction(null); setError(''); setNotice('已忽略这批未导入项，已导入原片和待上传记录均保留。可继续恢复下一批。'); } }
    catch (e) { if (live.current) setError(message(e)); }
    finally { if (live.current) setPicking(false); }
  }
  const bytesWaiting = queue.jobs.filter(job => job.status !== 'completed').reduce((sum, job) => sum + job.size, 0);
  return <section className="cloud-drive" aria-labelledby="cloud-drive-title">
    <header className="cloud-header"><button type="button" onClick={close} aria-label="返回上一页">‹ 返回</button><span className="cloud-child">{studentLabel || '当前孩子'}</span></header>
    <div className="cloud-hero"><span className="cloud-eyebrow">知燃 AI · 私有图片云盘</span><h2 id="cloud-drive-title">把原图安心存好</h2><p>当前归属：<strong>{studentLabel || '当前孩子'}</strong>。只保存你选择的原图，不自动分析题目。</p></div>
    <div className="cloud-select"><div><h3>批量上传图片</h3><p>每批最多 100 张 · 原图保存 · 不自动同步</p></div>
      <button type="button" className="cloud-primary" disabled={locked || !limits} onClick={() => void select()}>{picking ? '正在读取选图…' : services.native ? '从相册选择图片' : '选择图片'}</button>
      <input ref={input} type="file" multiple accept={limits?.mimeTypes.join(',') || 'image/jpeg,image/png,image/webp'} aria-label="选择云盘图片文件" hidden onChange={e => { const files = Array.from(e.currentTarget.files || []); e.currentTarget.value = ''; if (files.length) void filesSelected(files); }} />
      {services.recover && <button type="button" disabled={locked} onClick={() => void select(true)}>恢复上次选图</button>}
      <p className="cloud-hint">{limits ? `支持 JPEG、PNG、WebP；单张最多 ${sizeLabel(limits.maxFileBytes)}。不支持的图片会明确提示，不会压缩替换原件。` : '正在读取云盘限制…'}</p>
    </div>
    {(error || queue.error) && <p role="alert" className="cloud-error">{error || queue.error}</p>}{notice && <output className="cloud-notice">{notice}</output>}
    {recoveryAction && <button type="button" disabled={locked} onClick={() => void discardRecovery()}>忽略这批未导入项，保留原片</button>}
    <section className="cloud-panel" aria-labelledby="cloud-queue-title"><div className="cloud-section-heading"><h3 id="cloud-queue-title">本机待上传</h3><span>{waiting} 张待完成</span></div>
      {queue.jobs.length ? <>
        <div className="cloud-progress"><span>已存云盘 {uploadCount} / {queue.jobs.length} 张</span><progress max={queue.jobs.length} value={uploadCount} aria-label="本批上传进度" /></div>
        <div className="cloud-actions"><button type="button" className="cloud-primary" disabled={locked || !waiting || !limits} onClick={() => void start()}>{queue.jobs.some(job => job.status === 'failed' || job.status === 'paused') ? '继续上传 / 重试' : '开始上传'}</button>
          <button type="button" disabled={!queue.running} onClick={() => queueRef.current?.stop()}>停止继续上传</button></div>
        <p className="cloud-hint">逐张读取并上传；停止后保留已完成图片，未确认的项目可重试。离开页面会停止后续上传。</p>
        {photos.storage && bytesWaiting > photos.storage.limitBytes - photos.storage.usedBytes && <p className="cloud-error">本批原图大小超过家庭云盘剩余空间，部分图片可能无法上传。</p>}
        <ol className="cloud-queue">{queue.jobs.map(job => <li key={job.id} className={`cloud-job cloud-job-${job.status}`}><div className="cloud-job-text"><strong title={job.name}>{job.name}</strong><span>{sizeLabel(job.size)} · {job.status === 'uploading' ? queue.phase === 'reading' ? '读取并校验原图…' : '正在上传原图…' : statusLabel[job.status]}</span>{job.message && <p>{job.message}</p>}</div>
          <div className="cloud-job-actions">{['failed', 'paused'].includes(job.status) && <button type="button" disabled={locked} onClick={() => void start(job.id)} aria-label={`重试 ${job.name}`}>重试</button>}
          <button type="button" disabled={locked} onClick={() => void remove(job.id)} aria-label={`${job.status === 'completed' ? '清理记录' : '移除待上传'} ${job.name}`}>{job.status === 'completed' ? '清理记录' : '移除'}</button></div></li>)}</ol>
        <p className="cloud-hint">移除只清理本机上传记录，不会删除相册原图或云盘图片。</p>
      </> : <p className="cloud-empty">先选择图片，确认后再上传。你的相册不会被自动扫描。</p>}
    </section>
    <section className="cloud-panel" aria-labelledby="cloud-photos-title"><div className="cloud-section-heading"><h3 id="cloud-photos-title">{studentLabel || '当前孩子'}的云图</h3><button type="button" disabled={listing || !limits} onClick={() => void refresh()}>刷新</button></div>
      {photos.storage && <p className="cloud-hint">家庭云盘已用 {sizeLabel(photos.storage.usedBytes)} / {sizeLabel(photos.storage.limitBytes)}</p>}
      <div className="cloud-grid">{photos.photos.map(photo => <article className="cloud-photo" key={photo.id}>
        <button type="button" className="cloud-photo-open" onClick={() => setViewing(photo)} aria-label={`预览 ${photo.originalName}`}><PrivatePreview photo={photo} services={services} /><span>{photo.originalName}</span></button>
        <div className="cloud-photo-meta"><time>{new Date(photo.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}</time><span>{sizeLabel(photo.size)}</span></div>
        <button type="button" disabled={!!downloading} onClick={() => void download(photo)}>{downloading === photo.id ? '正在保存…' : '下载原图'}</button>
      </article>)}</div>
      {listing && <output className="cloud-empty">正在读取云图…</output>}{!listing && !photos.photos.length && <p className="cloud-empty">还没有云图。上传完成后会出现在这里。</p>}
      {photos.nextCursor && <button type="button" disabled={listing} onClick={() => void refresh(photos.nextCursor || undefined)}>加载更多</button>}
    </section>
    {viewing && <dialog ref={dialog} className="cloud-modal" aria-label="云图预览" onCancel={e => { e.preventDefault(); setViewing(null); }}><div><header><h3>{viewing.originalName}</h3><button type="button" onClick={() => setViewing(null)}>关闭预览</button></header><PrivatePreview photo={viewing} services={services} /><p className="cloud-hint">这里显示预览图，下载会保留原始图片字节。</p><button type="button" disabled={!!downloading} onClick={() => void download(viewing)}>下载原图</button></div></dialog>}
  </section>;
}

function PrivatePreview({ photo, services }: { photo: CloudPhoto; services: DriveServices }) {
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
