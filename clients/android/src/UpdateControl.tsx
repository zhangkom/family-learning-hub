import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { appName, appVersionCode } from './release';
import { AppUpdater, checkRelease, eligibleDelta, type Release, type UpdatePhase } from './updates';

function useUpdates() {
  const [release, setRelease] = useState<Release | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>('full');
  const [transferNotice, setTransferNotice] = useState('');
  const [ready, setReady] = useState(false);
  const [permission, setPermission] = useState(false);
  const busy = useRef(false), lastCheck = useRef(0), current = useRef<Release | null>(null);
  const mounted = useRef(true);
  const available = !!release && release.versionCode > appVersionCode;

  const check = useCallback(async (manual = false) => {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    setError('');
    setNotice('');
    if (manual) setExpanded(true);
    try {
      const next = await checkRelease();
      if (!mounted.current) return;
      if (current.current?.sha256 !== next.sha256) { setReady(false); setPermission(false); setTransferNotice(''); }
      current.current = next;
      setRelease(next);
      setNotice(next.versionCode > appVersionCode ? '' : '已是最新版本');
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : '检查更新失败，请稍后重试');
    } finally {
      lastCheck.current = Date.now();
      busy.current = false;
      if (mounted.current) setChecking(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void check();
    const resume = () => {
      if (Date.now() - lastCheck.current > 60 * 60 * 1000) void check();
    };
    const visible = () => { if (document.visibilityState === 'visible') resume(); };
    document.addEventListener('visibilitychange', visible);
    const timer = setInterval(visible, 60 * 60 * 1000);
    const listener = Capacitor.isNativePlatform()
      ? NativeApp.addListener('appStateChange', ({ isActive }) => { if (isActive) resume(); })
      : null;
    return () => { mounted.current = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible); void listener?.then((h) => h.remove()); };
  }, [check]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = AppUpdater.addListener('downloadProgress', ({ percent, phase: nextPhase }) => {
      if (mounted.current) {
        setProgress(Math.max(0, Math.min(100, Math.floor(percent))));
        if (nextPhase) setPhase(nextPhase);
        if (nextPhase === 'fallback') setTransferNotice('增量更新未能完成，已自动改用完整安装包。');
      }
    });
    return () => { void listener.then((h) => h.remove()); };
  }, []);

  async function install() {
    if (!release || !available || busy.current) return;
    busy.current = true;
    setError('');
    setPermission(false);
    try {
      if (!ready) {
        setProgress(0);
        setPhase(eligibleDelta(release, appVersionCode) ? 'delta' : 'full');
        setTransferNotice('');
        const result = await AppUpdater.download(release);
        setTransferNotice(result?.fallback ? '增量更新未能完成，已使用完整安装包。'
          : result?.mode === 'delta' ? '增量更新已合成并校验完成。' : '完整安装包已校验完成。');
        setReady(true);
      }
      setProgress(null);
      const result = await AppUpdater.install();
      setPermission(result.permissionRequired);
      setNotice(result.permissionRequired
        ? `请允许“${appName}”安装更新，返回后点击“继续安装”。`
        : '已打开系统安装页面。如果取消了安装，可以再次点击“继续安装”。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新未完成，请重试');
      setReady(false);
    } finally { setProgress(null); busy.current = false; }
  }
  async function settings() {
    try { await AppUpdater.openInstallSettings(); }
    catch { setError(`无法打开安装设置，请在系统设置中允许“${appName}”安装未知应用。`); }
  }
  return { release, available, expanded, setExpanded, checking, notice, error, progress, ready, phase, transferNotice,
    permission, check, install, settings };
}
const Updates = createContext<ReturnType<typeof useUpdates> | null>(null);
export function UpdateProvider({ children }: { children: ReactNode }) {
  const value = useUpdates();
  return <Updates.Provider value={value}>{children}</Updates.Provider>;
}
export function UpdateDot() {
  const update = useContext(Updates);
  return update?.available ? <span className="update-dot" aria-label="有新版本">●</span> : null;
}
export function UpdateControl() {
  const update = useContext(Updates)!;
  const { release, available, expanded, setExpanded, checking, notice, error, progress, ready, permission, phase, transferNotice } = update;
  const downloading = progress !== null;
  const delta = release && eligibleDelta(release, appVersionCode);
  const phaseText = { delta: '正在下载增量包', full: '正在下载完整包', prepare: '正在合成新版', verify: '正在校验安装包', fallback: '正在切换完整包' }[phase];
  return <section className="app-update" aria-label="应用更新">
    <div className="update-actions">
      {available && <button type="button" className="update-badge" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>● 发现新版本 {release!.version}</button>}
      <button type="button" className="update-check" onClick={() => void update.check(true)} disabled={checking || downloading}>
        {checking ? '正在检查…' : '检查更新'}
      </button>
    </div>
    {expanded && <div className="update-details">
      {available && <>
        <strong>{appName} {release!.version} · {(release!.bytes / 1_000_000).toFixed(2)} MB</strong>
        <p>{release!.notes}</p>
        {delta && <p>预计增量下载 {(delta.bytes / 1_000_000).toFixed(2)} MB，减少约 {Math.round((1 - delta.bytes / release!.bytes) * 100)}% 下载量；不适用时自动下载完整包。</p>}
        <p className="hint">覆盖升级会保留登录和学习资料。请先保存正在编辑的内容。</p>
        {downloading ? <output aria-live="polite"><progress value={progress} max="100" /><span>{phaseText}{phase === 'delta' || phase === 'full' ? ` ${progress}%` : '…'}</span></output>
          : Capacitor.isNativePlatform()
            ? <div className="button-row">
                {permission && <button type="button" onClick={() => void update.settings()}>允许安装更新</button>}
                <button type="button" className="primary" disabled={checking} onClick={() => void update.install()}>{ready ? '继续安装' : '下载并安装'}</button>
              </div>
            : <a href={release!.downloadUrl} target="_blank" rel="noopener noreferrer">下载 APK，在安卓设备安装</a>}
      </>}
      {notice && <output>{notice}</output>}
      {transferNotice && <output className="hint">{transferNotice}</output>}
      {error && <p role="alert">{error}</p>}
      <button type="button" className="update-check" onClick={() => setExpanded(false)}>收起</button>
    </div>}
  </section>;
}
