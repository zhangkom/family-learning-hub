import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { FamilyApi } from '../api';
import { createDriveServices } from './services';
import { driveStore } from './store';
import { UploadQueue, type QueueSnapshot } from './queue';
import { type CloudLimits, type CloudPage, type CloudPhoto, type DriveServices, type DriveStore, type PickResult, type PickedOriginal, type NameCheck, type NameChoice, type ResolveName, type ImportProgress } from './types';
import { NameConflictDialog } from './NameConflictDialog';
import { CloudPhotoBrowser, PrivatePreview } from './CloudPhotoBrowser';
import { browserFilesResult } from './browser-files';
import './cloud-drive.css';

export type CloudPhotoDriveProps = {
  api: FamilyApi; owner: string; studentId: string; studentLabel?: string; onClose: () => void; onOpenOriginals?: () => void;
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
function DriveSession({ api, owner, studentId, studentLabel, onClose, onOpenOriginals, services: supplied, store = driveStore }: CloudPhotoDriveProps) {
  const [nameRequest, setNameRequest] = useState<{ check: NameCheck; choose: (choice: NameChoice) => void } | null>(null);
  const resolveName: ResolveName = useCallback((check, signal) => new Promise<NameChoice>((resolve, reject) => {
    const clear = () => setNameRequest(current => current === request ? null : current);
    const abort = () => { clear(); reject(signal.reason); };
    const request = { check, choose: (choice: NameChoice) => { signal.removeEventListener('abort', abort); clear(); resolve(choice); } };
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener('abort', abort, { once: true }); setNameRequest(request);
  }), []);
  const services = useMemo(() => supplied || createDriveServices(api, resolveName), [api, supplied, resolveName]);
  const [queue, setQueue] = useState<QueueSnapshot>({ jobs: [], running: false });
  const [initialization, setInitialization] = useState<'loading' | 'failed' | 'ready'>('loading');
  const [initializationAttempt, setInitializationAttempt] = useState(0), [initializationError, setInitializationError] = useState('');
  const [limits, setLimits] = useState<CloudLimits | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [picking, setPicking] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null), [pendingImportIds, setPendingImportIds] = useState<string[]>([]);
  const [storage, setStorage] = useState<CloudPage['storage']>(), [refreshKey, setRefreshKey] = useState(0);
  const [viewing, setViewing] = useState<CloudPhoto | null>(null), [downloading, setDownloading] = useState('');
  const [recoveryAction, setRecoveryAction] = useState<{ run: () => Promise<void> } | null>(null);
  const controller = useRef<AbortController | null>(null), queueRef = useRef<UploadQueue | null>(null), input = useRef<HTMLInputElement>(null), folderInput = useRef<HTMLInputElement>(null);
  const live = useRef(false), closeRef = useRef<() => void>(() => {});
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; if (viewing && element && !element.open) element.showModal(); return () => element?.close(); }, [viewing]);
  const uploadCount = queue.jobs.filter(job => job.status === 'completed').length;
  const waiting = queue.jobs.length - uploadCount;
  const locked = queue.running || picking || initialization !== 'ready';
  const pendingImports = pendingImportIds.filter(id => !queue.jobs.some(job => job.id === id)).length;
  const totalSelected = queue.jobs.length + pendingImports;
  const refreshImports = useCallback(async () => {
    const signal = controller.current?.signal;
    if (!services.pendingImports || !signal || signal.aborted) return;
    const ids = await services.pendingImports({ owner, studentId }, signal);
    if (live.current && !signal.aborted) setPendingImportIds(ids);
  }, [services, owner, studentId]);
  const refresh = useCallback(() => { if (live.current) setRefreshKey(value => value + 1); }, []);
  useEffect(() => {
    live.current = true; const abort = new AbortController(); controller.current = abort;
    setInitialization('loading'); setInitializationError('');
    const work = new UploadQueue({ owner, studentId }, store, services); queueRef.current = work;
    const unsubscribe = work.subscribe(() => { if (live.current && !abort.signal.aborted) setQueue(work.snapshot()); });
    void Promise.all([work.load(), services.limits(abort.signal), refreshImports()]).then(([, cap]) => {
      if (live.current && !abort.signal.aborted) { setLimits(cap); setInitialization('ready'); refresh(); }
    }).catch(e => { if (live.current && !abort.signal.aborted) { setInitializationError(message(e)); setInitialization('failed'); } });
    return () => { live.current = false; abort.abort(); work.dispose(); unsubscribe(); };
  }, [owner, studentId, store, services, refresh, refreshImports, initializationAttempt]);
  function retryInitialization() {
    if (initialization !== 'failed' || queue.running || picking) return;
    setInitialization('loading'); setInitializationError(''); setInitializationAttempt(value => value + 1);
  }
  function close() { queueRef.current?.stop(); controller.current?.abort(); onClose(); }
  closeRef.current = () => { if (nameRequest) queueRef.current?.stop(); else if (viewing) setViewing(null); else close(); };
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener('backButton', () => closeRef.current());
    return () => { void listener.then(handle => handle.remove()); };
  }, []);
  async function addPicked(result: PickResult, recovering = false) {
    const signal = controller.current?.signal;
    if (!live.current || !signal || signal.aborted || !limits) return;
    const rejected: string[] = [], accepted: PickedOriginal[] = [];
    for (const item of result.items) {
      if (!limits.mimeTypes.includes(item.mimeType)) rejected.push(`${item.name}：暂不支持此格式`);
      else if (item.size > limits.maxFileBytes || item.size < 1) rejected.push(`${item.name}：超过单张大小限制或文件为空`);
      else accepted.push(item);
    }
    const added = accepted.length ? await queueRef.current?.add(accepted, !recovering) || 0 : 0;
    if (!live.current || signal.aborted) return;
    setRecoveryAction(result.discardRecovery ? { run: result.discardRecovery } : null);
    if (!rejected.length && !result.failures.length) await result.acknowledge?.();
    if (!live.current || signal.aborted) return;
    setNotice(result.cancelled && !accepted.length ? result.selectedCount ? '已暂停读取，可点“中断续传”继续。' : '已取消选图，可以重新选择。' : accepted.length ? `已选 ${result.selectedCount ?? result.items.length} 张，本次加入 ${added} 张。` : recovering ? '没有未完成的选图，可以直接重新选择。' : '没有新的图片需要加入');
    setError([...result.failures, ...rejected].join('；'));
  }
  async function select(recover = false, folderRange = false, albumRange = false) {
    const signal = controller.current?.signal; if (locked || !signal) return;
    setError(''); setNotice('');
    // Do not lock while a browser picker is open: cancelling may not emit change.
    if (!services.native && !recover) { (folderRange ? folderInput : input).current?.click(); return; }
    setPicking(true); setImportProgress(null);
    try {
      const progress = (value: ImportProgress) => { if (live.current && !signal.aborted) setImportProgress(value); };
      const result = recover ? await services.recover?.({ owner, studentId }, 2147483647, signal, progress) : await services.pick?.({ owner, studentId }, 2147483647, signal, folderRange, albumRange, progress);
      if (!result) throw new Error('此设备暂不支持此选图方式');
      await addPicked(result, recover);
      return !signal.aborted;
    } catch (e) { if (live.current && !signal.aborted) setError(message(e)); }
    finally {
      if (live.current && !signal.aborted) {
        try { await refreshImports(); } catch (e) { if (!signal.aborted) setError(message(e)); }
        if (live.current && !signal.aborted) { setPicking(false); setImportProgress(null); }
      }
    }
  }
  async function filesSelected(files: File[], folder = false) {
    const signal = controller.current?.signal;
    if (!files.length || locked || !live.current || !signal || signal.aborted) return;
    const work = queueRef.current, previousIds = new Set(work?.snapshot().jobs.map(job => job.id));
    setPicking(true); setError(''); setNotice('');
    try {
      await addPicked(browserFilesResult(files, folder));
    } catch (e) {
      if (live.current && !signal.aborted) {
        const saved = work?.snapshot().jobs.filter(job => !previousIds.has(job.id)).length || 0;
        setNotice(`本次选择 ${files.length} 个文件，已保存 ${saved} 张到待上传列表；还有 ${files.length - saved} 个未保存，需要重新选择。未保存项未计入上传进度。`);
        setError(message(e));
      }
    }
    finally { if (live.current && !signal.aborted) setPicking(false); }
  }
  async function start(id?: string) {
    if (locked) return; setError(''); setNotice('');
    await queueRef.current?.start(id);
    if (live.current) refresh();
  }
  async function continueInterrupted() {
    if (locked) return;
    const recovered = await select(true);
    if (!recovered || !live.current || controller.current?.signal.aborted) return;
    await queueRef.current?.start();
    if (live.current) refresh();
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
    try { await recoveryAction.run(); await refreshImports(); if (live.current) { setRecoveryAction(null); setError(''); setNotice('已忽略这批未导入项，已导入原片和待上传记录均保留。可继续恢复下一批。'); } }
    catch (e) { if (live.current) setError(message(e)); }
    finally { if (live.current) setPicking(false); }
  }
  const bytesWaiting = queue.jobs.filter(job => job.status !== 'completed').reduce((sum, job) => sum + job.size, 0);
  return <section className="cloud-drive" aria-labelledby="cloud-drive-title">
    {nameRequest && <NameConflictDialog key={nameRequest.check.token + nameRequest.check.name} check={nameRequest.check} onChoose={nameRequest.choose} onCancel={() => queueRef.current?.stop()} />}
    <header className="cloud-header"><button type="button" onClick={close} aria-label="返回上一页">‹ 返回</button><span className="cloud-child">{studentLabel || '当前孩子'}</span></header>
    <div className="cloud-hero"><h2 id="cloud-drive-title">图片云盘</h2><p>备份原图，保留原文件名</p></div>
    {initialization === 'loading' && <output className="cloud-loading">正在读取云盘与本机上传记录…</output>}
    {initialization === 'failed' && <section role="alert" className="cloud-error cloud-init-error"><div><strong>图片云盘暂未就绪</strong><p>{initializationError}</p><p>本机上传记录保留，重新加载后可继续。</p></div><button type="button" onClick={retryInitialization}>重新加载</button></section>}
    <div className="cloud-select"><div className="cloud-select-heading"><h3>批量上传图片</h3></div>
      <div className="cloud-pick-actions">
        <button type="button" className="cloud-primary" disabled={locked || !limits} onClick={() => void select(false, false, true)}>{picking ? '读取中…' : services.native ? '相册选择' : '选择图片'}</button>
        <button type="button" disabled={locked || !limits} onClick={() => void select(false, true)}>{services.native ? '文件夹范围' : '按文件夹选择'}</button>
      </div>
      <input ref={input} type="file" multiple accept={limits?.mimeTypes.join(',') || 'image/jpeg,image/png,image/webp'} aria-label="选择云盘图片文件" hidden onChange={e => { const files = Array.from(e.currentTarget.files || []); e.currentTarget.value = ''; if (files.length) void filesSelected(files); }} />
      {!services.native && <input ref={element => { folderInput.current = element; element?.setAttribute('webkitdirectory', ''); }} type="file" multiple aria-label="选择云盘图片文件夹" hidden onChange={e => { const files = Array.from(e.currentTarget.files || []); e.currentTarget.value = ''; if (files.length) void filesSelected(files, true); }} />}
      {services.native && <p className="cloud-hint">相册里点第一张，滚动后点最后一张，即可选中整段。</p>}
      {!services.native && <p className="cloud-hint">电脑可用 Shift 连选、Ctrl（Mac 为 ⌘）多选；手机按系统选图方式操作。</p>}
      <div className="cloud-secondary-actions">
        {services.native && <button type="button" disabled={locked || !limits} onClick={() => void select()}>系统相册多选</button>}
        {onOpenOriginals && <button type="button" disabled={locked} onClick={onOpenOriginals}>从本机照片收题</button>}
        <details className="cloud-help"><summary>选图说明</summary><p>{services.native ? '相册范围选择按照片时间由新到旧，首次使用需授权读取照片；文件夹范围按文件名排序。' : '按文件夹选择会包含子文件夹，按文件夹路径与文件名自然排序；不支持文件夹选择的浏览器可使用“选择图片”。原文件名保持不变，同名图片上传前由你决定如何处理。'}只导入确认的图片，点“开始上传”后才发送到云盘，不自动分析。</p><p>{services.native ? '未确认就返回，下次重新选择。确认后若中断，会显示“中断续传”：继续导入并上传未完成的照片，已成功上传的会跳过。' : '取消选择不会保存记录。确认后，待上传图片会保存到当前浏览器；离开后可回来继续上传，已成功上传的会跳过。清除网站数据或使用其他浏览器后需重新选择。'}</p><p>{limits ? `支持 JPEG、PNG、WebP；单张最多 ${sizeLabel(limits.maxFileBytes)}。` : initialization === 'failed' ? '云盘限制尚未读取，请先重新加载。' : '正在读取云盘限制…'}</p></details>
      </div>
    </div>
    {(error || queue.error) && <p role="alert" className="cloud-error">{error || queue.error}</p>}{notice && <output className="cloud-notice">{notice}</output>}
    {picking && importProgress && <output className="cloud-notice">正在保存到本机 {importProgress.imported}/{importProgress.total}{importProgress.failed ? `，${importProgress.failed} 张需重试` : ''}</output>}
    {!picking && pendingImports > 0 && <output className="cloud-error cloud-import-warning">还有 {pendingImports} 张所选照片未导入。<button type="button" disabled={locked} onClick={() => void continueInterrupted()}>中断续传</button></output>}
    {recoveryAction && <button type="button" disabled={locked} onClick={() => void discardRecovery()}>忽略这批未导入项，保留原片</button>}
    {!!totalSelected && <section className="cloud-panel" aria-labelledby="cloud-queue-title"><div className="cloud-section-heading"><h3 id="cloud-queue-title">{waiting || pendingImports ? '本机待上传' : '上传记录'}</h3><span aria-label="上传完成数量">{uploadCount}/{totalSelected}</span></div>
        <div className="cloud-progress"><progress max={totalSelected} value={uploadCount} aria-label="全部图片上传进度" /></div>
        {(waiting > 0 || queue.running) && <div className="cloud-actions"><button type="button" className="cloud-primary" disabled={locked || !waiting || !limits} onClick={() => void start()}>{pendingImports ? '上传已导入照片' : queue.jobs.some(job => job.status === 'failed' || job.status === 'paused') ? '中断续传' : '开始上传'}</button>
          {queue.running && <button type="button" onClick={() => queueRef.current?.stop()}>停止继续上传</button>}</div>}
        {waiting > 0 && <p className="cloud-hint">离开页面会暂停后续上传，可回来继续。</p>}
        {storage && bytesWaiting > storage.limitBytes - storage.usedBytes && <p className="cloud-error">本批原图大小超过家庭云盘剩余空间，部分图片可能无法上传。</p>}
        <ol className="cloud-queue">{queue.jobs.map(job => <li key={job.id} className={`cloud-job cloud-job-${job.status}`}><div className="cloud-job-text"><strong title={job.name}>{job.name}</strong><span>{sizeLabel(job.size)} · {job.status === 'uploading' ? queue.phase === 'naming' ? '检查图片名称…' : queue.phase === 'reading' ? '读取并校验原图…' : '正在上传原图…' : statusLabel[job.status]}</span>{job.message && <p>{job.message}</p>}</div>
          <div className="cloud-job-actions">{['failed', 'paused'].includes(job.status) && <button type="button" disabled={locked} onClick={() => void start(job.id)} aria-label={`重试 ${job.name}`}>重试</button>}
          <button type="button" disabled={locked} onClick={() => void remove(job.id)} aria-label={`${job.status === 'completed' ? '清理记录' : '移除待上传'} ${job.name}`}>{job.status === 'completed' ? '清理记录' : '移除'}</button></div></li>)}</ol>
        <p className="cloud-hint">移除只清理本机上传记录，不会删除相册原图或云盘图片。</p>
    </section>}
    {initialization === 'ready' && <CloudPhotoBrowser services={services} studentId={studentId} archiveEnabled={limits?.archiveVersion === 1} refreshKey={refreshKey}
      onStorage={setStorage} onView={setViewing} onDownload={photo => void download(photo)} downloading={downloading} />}
    {viewing && <dialog ref={dialog} className="cloud-modal" aria-label="云图预览" onCancel={e => { e.preventDefault(); setViewing(null); }}><div><header><h3>{viewing.originalName}</h3><button type="button" onClick={() => setViewing(null)}>关闭预览</button></header><PrivatePreview photo={viewing} services={services} /><p className="cloud-hint">{viewing.archive && `${viewing.archive.subject} · ${viewing.archive.title} · 第 ${viewing.archive.pageNumber} 页。`}这里显示预览图，下载会保留原始图片字节。</p><button type="button" disabled={!!downloading} onClick={() => void download(viewing)}>下载原图</button></div></dialog>}
  </section>;
}
