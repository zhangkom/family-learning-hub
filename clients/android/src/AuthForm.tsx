import { useEffect, useState, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { FamilyApi, validateServer } from './api';
import { BrandMark } from './Brand';
import { PermissionInfo } from './PermissionInfo';
import { appName, configuredServer } from './release';
import type { Auth } from './restore-session';

export type AuthMode = 'login' | 'register';
const upcoming = new Set(['错题本', '分步辅导', '举一反三', '学习报告']);
type Props = { initialMode: AuthMode; feature?: string; initialError: string;
  onBack: () => void; onLogin: (auth: Auth) => Promise<void>; children: ReactNode };

export function AuthForm({ initialMode, feature, initialError, onBack, onLogin, children }: Props) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [server, setServer] = useState(() => {
    if (configuredServer) return configuredServer;
    try { return localStorage.getItem('family-learning:server') || ''; } catch { return ''; }
  });
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError), [attempt, setAttempt] = useState(0);
  const [registration, setRegistration] = useState<{ base: string; enabled: boolean } | null>(null);
  const [checking, setChecking] = useState(false), [statusError, setStatusError] = useState('');
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener('backButton', () => { if (!busy) onBack(); });
    return () => { void listener.then((handle) => handle.remove()); };
  }, [busy, onBack]);
  useEffect(() => {
    if (mode !== 'register') return;
    let alive = true;
    setRegistration(null); setStatusError(''); setChecking(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const base = validateServer(server);
          const status = await new FamilyApi(base).setupStatus();
          if (alive) setRegistration({ base, enabled: status.registrationEnabled === true });
        } catch { if (alive) setStatusError('暂时无法连接注册服务，请稍后重试。'); }
        finally { if (alive) setChecking(false); }
      })();
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [server, mode, attempt]);
  function switchMode(next: AuthMode) {
    setMode(next); setPassword(''); setError(''); setVisible(false);
  }
  const registering = mode === 'register';
  return <main className="auth-page">
    <header className="auth-header">
      <button type="button" className="auth-back" disabled={busy} onClick={onBack}><ArrowLeft size={19} />返回首页</button>
      <div className="brand"><BrandMark size={32} /><span>{appName}</span></div>
    </header>
    <section className="auth-card">
      <span className="eyebrow">让每一次学习，都留下收获</span>
      <h1>{registering ? '注册' : '登录'}</h1>
      {feature ? <p className="auth-feature-context">{upcoming.has(feature)
        ? `${feature}正在准备中。你可以先注册或登录，开始拍题与校对。`
        : `使用${feature}，请先注册或登录。`}</p>
        : <p>一个账号管理多个孩子，学习资料分别保存。</p>}
      <div className="auth-tabs" role="tablist" aria-label="注册或登录">
        <button type="button" role="tab" aria-selected={registering} disabled={busy} onClick={() => switchMode('register')}>注册</button>
        <button type="button" role="tab" aria-selected={!registering} disabled={busy} onClick={() => switchMode('login')}>登录</button>
      </div>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setError('');
        let created = false;
        try {
          const base = validateServer(server);
          if (registering && (!registration?.enabled || registration.base !== base))
            throw new Error('注册暂不可用，请重新检查。');
          const api = new FamilyApi(base);
          const result = registering ? await api.register(username.trim(), password) : await api.login(username.trim(), password);
          created = registering;
          try { localStorage.setItem('family-learning:server', base); } catch { /* Optional setting. */ }
          await onLogin({ base, token: result.token, user: result.user });
          setPassword('');
        } catch (reason) {
          if (created) {
            switchMode('login');
            setError('账号已注册，请用刚设置的账号和密码登录。');
          } else setError(reason instanceof Error ? reason.message : '操作未完成，请重试。');
        } finally { setBusy(false); }
      }}>
        {!configuredServer && <label>家庭服务地址<input type="url" value={server} onChange={(event) => setServer(event.target.value)} required disabled={busy} placeholder="管理员提供的 HTTPS 地址" /></label>}
        <label>账号<input aria-label="账号" autoComplete="username" autoCapitalize="none" spellCheck={false}
          value={username} onChange={(event) => setUsername(event.target.value)} required disabled={busy}
          pattern={registering ? '[A-Za-z0-9_-]{3,32}' : undefined} minLength={registering ? 3 : undefined} maxLength={32}
          placeholder={registering ? '设置账号' : '请输入账号'} aria-describedby={registering ? 'account-help' : undefined} /></label>
        {registering && <small id="account-help" className="hint">3–32 位字母、数字、下划线或短横线。</small>}
        <label>密码<span className="password-field"><input aria-label="密码" type={visible ? 'text' : 'password'}
          autoComplete={registering ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)}
          minLength={registering ? 6 : undefined} maxLength={128} required disabled={busy}
          placeholder={registering ? '设置密码，6 位起' : '请输入密码'} aria-describedby={registering ? 'password-help' : undefined} />
          <button type="button" aria-label={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button>
        </span></label>
        {registering && <small id="password-help" className="hint">6–128 位，支持数字或字母。</small>}
        {registering && <div className="registration-status" aria-live="polite">
          {checking ? <p>正在连接注册服务…</p> : statusError ? <><p>{statusError}</p><button type="button" onClick={() => setAttempt((n) => n + 1)}>重试</button></>
            : registration && !registration.enabled ? <p>注册暂未开放，你仍可浏览首页或使用已有账号登录。</p> : null}
        </div>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary full" disabled={busy || (registering && (checking || !registration?.enabled))}>{busy ? registering ? '正在注册…' : '正在登录…' : registering ? '注册' : '登录'}</button>
        <button className="auth-browse" type="button" disabled={busy} onClick={onBack}>先逛逛</button>
      </form>
      {children}
      <PermissionInfo />
    </section>
  </main>;
}
