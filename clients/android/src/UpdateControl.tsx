import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { appVersionCode } from './release';
import { AppUpdater, checkRelease, type Release } from './updates';

function useUpdates() {
  const [release, setRelease] = useState<Release | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
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
      if (current.current?.sha256 !== next.sha256) { setReady(false); setPermission(false); }
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
    const listener = AppUpdater.addListener('downloadProgress', ({ percent }) => {
      if (mounted.current) setProgress(Math.max(0, Math.min(100, Math.floor(percent))));
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
        await AppUpdater.download(release);
        setReady(true);
      }
      setProgress(null);
      const result = await AppUpdater.install();
      setPermission(result.permissionRequired);
      setNotice(result.permissionRequired
        ? '请允许“一起学”安装更新，返回后点击“继续安装”。'
        : '已打开系统安装页面。如果取消了安装，可以再次点击“继续安装”。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新未完成，请重试');
      setReady(false);
    } finally { setProgress(null); busy.current = false; }
  }
  async function settings() {
    try { await AppUpdater.openInstallSettings(); }
    catch { setError('无法打开安装设置，请在系统设置中允许“一起学”安装未知应用。'); }
  }
  return { release, available, expanded, setExpanded, checking, notice, error, progress, ready,
    permission, check, install, settings };
}
const Updates = createContext<ReturnType<typeof useUpdates> | null>(null);
export function UpdateProvider({ children }: { children: ReactNode }) {
  const value = useUpdates();
  return <Updates.Provider value={value}>{children}</Updates.Provider>;
}
export function UpdateControl() {
  const update = useContext(Updates)!;
  const { release, available, expanded, setExpanded, checking, notice, error, progress, ready, permission } = update;
  const downloading = progress !== null;
  return <section className="app-update" aria-label="应用更新">
    <div className="update-actions">
      {available && <button type="button" className="update-badge" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>● 发现新版本 {release!.version}</button>}
      <button type="button" className="update-check" onClick={() => void update.check(true)} disabled={checking || downloading}>
        {checking ? '正在检查…' : '检查更新'}
      </button>
    </div>
    {expanded && <div className="update-details">
      {available && <>
        <strong>一起学 {release!.version} · {(release!.bytes / 1_000_000).toFixed(2)} MB</strong>
        <p>{release!.notes}</p>
        <p className="hint">覆盖升级会保留登录和学习资料。请先保存正在编辑的内容。</p>
        {downloading ? <output><progress value={progress} max="100" /><span>下载并校验中 {progress}%</span></output>
          : Capacitor.isNativePlatform()
            ? <div className="button-row">
                {permission && <button type="button" onClick={() => void update.settings()}>允许安装更新</button>}
                <button type="button" className="primary" disabled={checking} onClick={() => void update.install()}>{ready ? '继续安装' : '下载并安装'}</button>
              </div>
            : <a href={release!.downloadUrl} target="_blank" rel="noopener noreferrer">下载 APK，在安卓设备安装</a>}
      </>}
      {notice && <output>{notice}</output>}
      {error && <p role="alert">{error}</p>}
      <button type="button" className="update-check" onClick={() => setExpanded(false)}>收起</button>
    </div>}
  </section>;
}
