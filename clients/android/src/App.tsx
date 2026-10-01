import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { Camera } from '@capacitor/camera';
import {
  ArrowRight,
  BookOpen,
  Camera as CameraIcon,
  Check,
  ChevronRight,
  FileImage,
  ImagePlus,
  LogOut,
  Plus,
  RefreshCw,
  Users,
} from 'lucide-react';
import { ApiError, FamilyApi, validateServer, sessionExpiredEvent } from './api';
import { session } from './session';
import { drafts, type Draft } from './drafts';
import { Review } from './Review';
import { statusNames, type Scan, type Student } from './types';
import { appVersion, configuredServer, familyWebsite } from './release';
import { restoreSession, type Auth } from './restore-session';
import { UpdateControl } from './UpdateControl';

function message(error: unknown) {
  return error instanceof Error ? error.message : '操作未完成，请重试';
}
function readSetting(key: string, fallback = '') {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function saveSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Settings are optional; server records remain authoritative. */
  }
}
const selectionKey = (owner: string) => `family-learning:selected:${owner}`;
export function App() {
  const [auth, setAuth] = useState<Auth | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [restoreError, setRestoreError] = useState(''),
    [restoreAttempt, setRestoreAttempt] = useState(0);
  useEffect(() => {
    const expired = (event: Event) => {
      const source = (event as CustomEvent<{ base: string; token: string }>)
        .detail;
      if (!auth || source.base !== auth.base || source.token !== auth.token)
        return;
      void session.clear().catch(() => {});
      setAuth(null);
      setError('登录已过期，请重新登录。未完成的本机草稿仍然保留。');
    };
    window.addEventListener(sessionExpiredEvent, expired);
    return () => window.removeEventListener(sessionExpiredEvent, expired);
  }, [auth]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setRestoreError('');
    void restoreSession()
      .then((value) => {
        if (alive && value) setAuth(value);
      })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) setError(message(e));
        else setRestoreError(message(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [restoreAttempt]);
  if (loading)
    return (
      <div className="loading-screen">
        <BookOpen />
        <p>正在打开家庭学习…</p>
      </div>
    );
  if (restoreError)
    return (
      <main className="loading-screen">
        <BookOpen />
        <h2>暂时连不上家庭服务</h2>
        <p>登录信息和本机草稿仍然保留，请检查网络后重试。</p>
        <p className="hint" role="alert">{restoreError}</p>
        <div className="button-row">
          <button className="primary" onClick={() => setRestoreAttempt((n) => n + 1)}>重新连接</button>
          <button onClick={async () => {
            try {
              await session.clear();
              setRestoreError('');
            } catch (e) { setRestoreError(message(e)); }
          }}>换账号登录</button>
        </div>
        <FamilyLinks />
      </main>
    );
  if (!auth)
    return (
      <LoginForm
        initialError={error}
        onLogin={async (next) => {
          await session.save(
            JSON.stringify({ base: next.base, token: next.token }),
          );
          setError('');
          setAuth(next);
        }}
      />
    );
  return (
    <Home
      key={`${auth.base}|${auth.user.id}`}
      auth={auth}
      onLogout={async () => {
        await session.clear();
        setAuth(null);
      }}
    />
  );
}

function LoginForm({
  initialError,
  onLogin,
}: {
  initialError: string;
  onLogin: (auth: Auth) => Promise<void>;
}) {
  const [server, setServer] = useState(
    configuredServer || readSetting('family-learning:server'),
  );
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError);
  const [mode, setMode] = useState<'login' | 'setup'>('login'),
    [setupToken, setSetupToken] = useState(''),
    [confirmation, setConfirmation] = useState('');
  const [setup, setSetup] = useState<{
    base: string; enabled: boolean; needsSetup: boolean;
  } | null>(null),
    [checking, setChecking] = useState(false),
    [setupError, setSetupError] = useState(''),
    [setupAttempt, setSetupAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setSetup(null);
    setSetupError('');
    setChecking(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const base = validateServer(server);
          const status = await new FamilyApi(base).setupStatus();
          if (alive) setSetup({ ...status, base });
        } catch {
          if (alive) setSetupError('暂时无法检查注册状态，已有账号仍可直接登录。');
        } finally {
          if (alive) setChecking(false);
        }
      })();
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [server, setupAttempt]);
  const canSetup = !!setup?.enabled && setup.needsSetup;
  function switchMode(next: 'login' | 'setup') {
    setMode(next);
    setError('');
    setPassword('');
    setConfirmation('');
    setSetupToken('');
  }
  return (
    <main className={`login-page ${mode === 'setup' ? 'setup-mode' : ''}`}>
      <div className="login-story">
        <div className="brand">
          <span className="brand-icon">
            <BookOpen size={23} />
          </span>
          一起学<span className="brand-note">家庭学习</span>
        </div>
        <div className="story-copy">
          <span className="eyebrow">从孩子写下的每一步开始</span>
          <h1>
            看见思路，
            <br />
            一起学会。
          </h1>
          <p>
            拍下题目和解题过程，
            <br />
            把每一次尝试，变成下一步的起点。
          </p>
          <div className="story-steps">
            <span>
              <CameraIcon size={18} /> 拍下作业
            </span>
            <i />
            <span>
              <FileImage size={18} /> 核对步骤
            </span>
            <i />
            <span>
              <BookOpen size={18} /> 逐步学会
            </span>
          </div>
        </div>
        <div className="paper-illustration" aria-hidden="true">
          <div className="paper-label">每一步，都值得看清楚</div>
          <p>2(x + 3) = 10</p>
          <div className="handwritten">2x + 3 = 10</div>
          <div className="paper-comment">先看看，括号应该怎样展开？</div>
          <div className="paper-line" />
          <div className="paper-line short" />
        </div>
        <small className="illustration-note">
          示意题目 · 不是孩子的真实记录
        </small>
      </div>
      <section className="login-card">
        <span className="eyebrow">欢迎回家</span>
        <h2>{mode === 'setup' ? '注册家庭账号' : '登录家庭账号'}</h2>
        <p>{mode === 'setup' ? '家长注册一次，就可以添加和切换多个孩子。' : '登录后，选择今天学习的孩子。'}</p>
        <div className="auth-tabs" role="tablist" aria-label="登录或注册">
          <button type="button" role="tab" aria-selected={mode === 'login'} disabled={busy} onClick={() => switchMode('login')}>已有账号登录</button>
          <button type="button" role="tab" aria-selected={mode === 'setup'} disabled={busy} onClick={() => switchMode('setup')}>首次注册家庭账号</button>
        </div>
        {mode === 'login' && canSetup && (
          <p className="notice">还没有账号？点击“首次注册家庭账号”，由家长设置账号和密码。</p>
        )}
        {mode === 'setup' && (
          <div className="setup-guidance" aria-live="polite">
            {checking ? <p>正在检查注册状态…</p> : setupError ? (
              <><p>{setupError}</p><button type="button" onClick={() => setSetupAttempt((n) => n + 1)}>重新检查</button></>
            ) : canSetup ? (
              <p>使用私下提供的家庭启用码开通。请自行设置账号和密码，注册后直接进入家庭学习。</p>
            ) : (
              <p>当前家庭注册入口已关闭。已有家庭成员请使用家长创建的账号登录；新增家庭需由管理员开通。</p>
            )}
            <a href={`${familyWebsite}account`} target={Capacitor.isNativePlatform() ? '_self' : '_blank'} rel="noopener noreferrer">也可以在网页开通或登录</a>
          </div>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            if (mode === 'setup' && password !== confirmation) {
              setError('两次输入的密码不一致，请重新确认。');
              return;
            }
            setBusy(true);
            setError('');
            let created = false;
            try {
              const base = validateServer(server);
              if (mode === 'setup' && (!canSetup || setup?.base !== base))
                throw new Error('请先重新检查家庭注册状态。');
              const api = new FamilyApi(base);
              const result = mode === 'setup'
                ? await api.setup(username.trim(), password, setupToken.trim())
                : await api.login(username.trim(), password);
              created = mode === 'setup';
              setSetupToken('');
              setConfirmation('');
              saveSetting('family-learning:server', base);
              await onLogin({ base, token: result.token, user: result.user });
              setPassword('');
            } catch (err) {
              if (created || (mode === 'setup' && err instanceof ApiError && err.status === 409)) {
                switchMode('login');
                setSetupAttempt((n) => n + 1);
                setError(created ? '账号已注册，但登录信息未能保存。请用刚设置的账号和密码登录。' : '家庭账号已创建，请使用已有账号登录。');
              } else {
                setError(message(err));
                if (mode === 'setup') setSetupAttempt((n) => n + 1);
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          {!configuredServer && (
            <label>
              家庭服务地址
              <input
                type="url"
                value={server}
                onChange={(e) => { setServer(e.target.value); switchMode('login'); }}
                placeholder="管理员提供的 HTTPS 地址"
                required
                disabled={busy}
              />
            </label>
          )}
          {mode === 'setup' && (
            <label>
              家庭启用码
              <input type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={setupToken} onChange={(e) => setSetupToken(e.target.value)} placeholder="粘贴私下提供的启用码" required maxLength={512} disabled={busy || !canSetup} />
            </label>
          )}
          <label>
            家庭账号
            <input
              autoComplete="username"
              aria-label="家庭账号"
              aria-describedby={mode === 'setup' ? 'setup-username-help' : undefined}
              autoCapitalize="none"
              spellCheck={false}
              pattern={mode === 'setup' ? '[A-Za-z0-9_-]{3,32}' : undefined}
              minLength={mode === 'setup' ? 3 : undefined}
              maxLength={32}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={mode === 'setup' ? '例如 family2026' : '请输入账号'}
              required
              disabled={busy}
            />
            {mode === 'setup' && <small id="setup-username-help">3–32 位英文字母、数字、下划线或短横线。</small>}
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              aria-label="密码"
              aria-describedby={mode === 'setup' ? 'setup-password-help' : undefined}
              minLength={mode === 'setup' ? 12 : undefined}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'setup' ? '设置至少 12 位密码' : '请输入密码'}
              required
              disabled={busy}
            />
            {mode === 'setup' && <small id="setup-password-help">至少 12 位；请记住密码，家长网页与 App 共用此账号。</small>}
          </label>
          {mode === 'setup' && (
            <label>
              确认密码
              <input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="再次输入密码" required disabled={busy} />
            </label>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary full" disabled={busy || (mode === 'setup' && (!canSetup || checking))}>
            {busy ? mode === 'setup' ? '正在注册…' : '正在登录…' : mode === 'setup' ? '注册并进入家庭学习' : '进入家庭学习'}
            <ArrowRight size={18} />
          </button>
          <p className="login-help">
            一个家庭共用一个账号，孩子分别建立学习档案，不需要每个孩子单独注册。
          </p>
          <FamilyLinks />
        </form>
      </section>
    </main>
  );
}

function Home({
  auth,
  onLogout,
}: {
  auth: Auth;
  onLogout: () => Promise<void>;
}) {
  const api = useMemo(
    () => new FamilyApi(auth.base, auth.token),
    [auth.base, auth.token],
  );
  const owner = `${auth.base}|${auth.user.id}`;
  const [students, setStudents] = useState<Student[]>([]),
    [selected, setSelected] = useState(readSetting(selectionKey(owner)));
  const [records, setRecords] = useState<Scan[]>([]),
    [localDrafts, setDrafts] = useState<Draft[]>([]),
    [openScan, setOpenScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [add, setAdd] = useState(false),
    [name, setName] = useState(''),
    [grade, setGrade] = useState('');
  const [refreshing, setRefreshing] = useState(false),
    [recognition, setRecognition] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null),
    galleryInput = useRef<HTMLInputElement>(null);
  const captureStudent = useRef(''),
    activeStudent = useRef(selected),
    requestNumber = useRef(0);
  activeStudent.current = selected;
  const student = students.find((s) => s.id === selected);
  const refreshDrafts = useCallback(async () => {
    setDrafts(await drafts.list(owner));
  }, [owner]);
  const refresh = useCallback(async () => {
    const id = activeStudent.current,
      generation = ++requestNumber.current;
    if (!id) {
      setRecords([]);
      return;
    }
    setRefreshing(true);
    try {
      const result = await api.scans(id);
      if (
        generation === requestNumber.current &&
        id === activeStudent.current
      ) {
        setRecords(result.scans);
        setRecognition(
          (result as { recognition?: boolean }).recognition === true,
        );
      }
    } catch (e) {
      if (generation === requestNumber.current) setError(message(e));
    } finally {
      if (generation === requestNumber.current) setRefreshing(false);
    }
  }, [api]);
  useEffect(() => {
    let alive = true;
    void api
      .students()
      .then(({ students: list }) => {
        if (!alive) return;
        setStudents(list);
        setSelected((id) =>
          list.some((s) => s.id === id) ? id : list[0]?.id || '',
        );
      })
      .catch((e) => {
        if (alive) setError(message(e));
      });
    void refreshDrafts().catch((e) => {
      if (alive) setError(message(e));
    });
    return () => {
      alive = false;
    };
  }, [api, refreshDrafts]);
  useEffect(() => {
    setRecords([]);
    setError('');
    setNotice('');
    saveSetting(selectionKey(owner), selected);
    void refresh();
  }, [selected, owner, refresh]);
  useEffect(() => {
    if (
      !records.some((r) => ['queued', 'processing'].includes(r.status)) ||
      openScan
    )
      return;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [records, refresh, openScan]);
  const savePhoto = useCallback(
    async (file: Blob, studentId: string, filename: string) => {
      if (!studentId) throw new Error('请先选择学生');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
        throw new Error('请使用 JPEG、PNG 或 WebP 图片');
      if (file.size > 8 * 1024 * 1024)
        throw new Error('图片超过 8 MB，请调整拍摄分辨率后重试');
      const draft: Draft = {
        id: crypto.randomUUID(),
        owner,
        studentId,
        source: '手机拍照与导入',
        name: filename,
        file,
        createdAt: Date.now(),
      };
      await drafts.save(draft);
      await refreshDrafts();
      setNotice('照片已保存为本机草稿，确认清晰完整后上传');
    },
    [owner, refreshDrafts],
  );
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener('appRestoredResult', (event) => {
      if (event.pluginId !== 'Camera' || !event.success) return;
      const context = JSON.parse(
        readSetting('family-learning:pending-camera', 'null'),
      ) as { owner: string; studentId: string } | null;
      if (!context || context.owner !== owner) return;
      const data = event.data as {
        webPath?: string;
        results?: { webPath?: string }[];
      };
      const path = data.webPath || data.results?.[0]?.webPath;
      if (path)
        void fetch(path)
          .then((r) => r.blob())
          .then((blob) =>
            savePhoto(blob, context.studentId, `作业-${Date.now()}.jpg`),
          )
          .then(() => localStorage.removeItem('family-learning:pending-camera'))
          .catch((e) => setError(message(e)));
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [owner, savePhoto]);
  async function capture(source: 'camera' | 'gallery') {
    if (!student) return;
    setError('');
    captureStudent.current = student.id;
    if (!Capacitor.isNativePlatform()) {
      (source === 'camera' ? cameraInput : galleryInput).current?.click();
      return;
    }
    const context = { owner, studentId: student.id };
    saveSetting('family-learning:pending-camera', JSON.stringify(context));
    setBusy(true);
    try {
      const photo =
        source === 'camera'
          ? await Camera.takePhoto({
              quality: 95,
              includeMetadata: true,
              saveToGallery: false,
            })
          : (
              await Camera.chooseFromGallery({
                allowMultipleSelection: false,
                includeMetadata: true,
              })
            ).results[0];
      if (!photo?.webPath) return;
      const file = await fetch(photo.webPath).then((r) => r.blob());
      await savePhoto(
        file,
        context.studentId,
        `作业-${Date.now()}.${file.type.split('/')[1] || 'jpg'}`,
      );
    } catch (e) {
      setError(`未取得照片，可以重试或从相册选择。${message(e)}`);
    } finally {
      setBusy(false);
      localStorage.removeItem('family-learning:pending-camera');
    }
  }
  async function upload(draft: Draft) {
    if (uploading) return;
    setUploading(draft.id);
    setError('');
    try {
      const { scan } = await api.upload(draft);
      await drafts.remove(draft.id);
      await refreshDrafts();
      if (activeStudent.current === draft.studentId) {
        setRecords((list) => [scan, ...list.filter((r) => r.id !== scan.id)]);
        setNotice('原图已保存。打开资料后可开始识别或手动校对。');
      }
    } catch (e) {
      setError(`上传未完成，草稿已保留：${message(e)}`);
    } finally {
      setUploading('');
    }
  }
  const updateScan = useCallback(
    (scan: Scan) =>
      setRecords((list) => list.map((r) => (r.id === scan.id ? scan : r))),
    [],
  );
  if (openScan)
    return (
      <Review
        key={openScan.id}
        api={api}
        owner={owner}
        scan={openScan}
        studentName={
          students.find((s) => s.id === openScan.studentId)?.name || '当前学生'
        }
        recognitionEnabled={recognition}
        onBack={() => {
          setOpenScan(null);
          void refresh();
        }}
        onUpdate={updateScan}
      />
    );
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <BookOpen size={21} />
          </span>
          一起学<span className="brand-note">家庭学习</span>
        </div>
        <div className="account">
          <span>{auth.user.username}</span>
          <button
            className="icon-button"
            aria-label="退出登录"
            disabled={busy || !!uploading}
            onClick={async () => {
              try {
                setBusy(true);
                await api.logout();
                await onLogout();
              } catch (e) {
                setError(`退出未完成：${message(e)}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <main className="dashboard">
        <section className="student-section">
          <div className="section-line">
            <span className="eyebrow">今天和谁一起学？</span>
            <button onClick={() => setAdd(!add)}>
              <Plus size={16} /> 添加学生
            </button>
          </div>
          <nav className="student-tabs" aria-label="选择学生">
            {students.map((s, index) => (
              <button
                key={s.id}
                className={`student-tab ${selected === s.id ? 'active' : ''}`}
                onClick={() => setSelected(s.id)}
              >
                <span className={`avatar tone-${index % 3}`}>
                  {s.name.slice(0, 1)}
                </span>
                <span>
                  <strong>{s.name}</strong>
                  <small>{s.grade || '学习档案'}</small>
                </span>
                {selected === s.id && <Check size={17} />}
              </button>
            ))}
          </nav>
          {add && (
            <form
              className="add-student"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                try {
                  const { student: s } = await api.addStudent(
                    name.trim(),
                    grade.trim(),
                  );
                  setStudents((list) => [...list, s]);
                  setSelected(s.id);
                  setName('');
                  setGrade('');
                  setAdd(false);
                } catch (err) {
                  setError(message(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                学生昵称
                <input
                  value={name}
                  maxLength={60}
                  required
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：小宝"
                />
              </label>
              <label>
                年级（选填）
                <input
                  value={grade}
                  maxLength={80}
                  onChange={(e) => setGrade(e.target.value)}
                  placeholder="例如：初一"
                />
              </label>
              <button className="primary" disabled={busy}>
                添加
              </button>
            </form>
          )}
        </section>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && <output className="notice">{notice}</output>}
        {student ? (
          <>
            <section className="learning-intro">
              <div>
                <span className="subject-tag">数学 · {student.name}</span>
                <h1>
                  从一道题，
                  <br className="mobile-break" />
                  看清每一步。
                </h1>
                <p>
                  题目和手写过程一起拍，
                  <br className="mobile-break" />
                  学习记录会保存在 {student.name} 的档案里。
                </p>
              </div>
              <div className="intro-mark" aria-hidden="true">
                <span>?</span>
                <i>✦</i>
              </div>
            </section>
            <section className="capture-card">
              <div className="capture-copy">
                <span className="camera-circle">
                  <CameraIcon size={29} />
                </span>
                <div>
                  <h2>拍下今天的题目</h2>
                  <p>一张照片可以包含多道题，记得拍全条件和解题过程。</p>
                </div>
              </div>
              <div className="capture-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void capture('camera')}
                >
                  <CameraIcon size={18} /> 拍照上传
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void capture('gallery')}
                >
                  <ImagePlus size={18} /> 从相册选择
                </button>
              </div>
              <input
                className="visually-hidden"
                ref={cameraInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void savePhoto(
                      file,
                      captureStudent.current,
                      file.name,
                    ).catch((err) => setError(message(err)));
                  e.target.value = '';
                }}
              />
              <input
                className="visually-hidden"
                ref={galleryInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void savePhoto(
                      file,
                      captureStudent.current,
                      file.name,
                    ).catch((err) => setError(message(err)));
                  e.target.value = '';
                }}
              />
              <div className="capture-foot">
                <span>01 拍完整</span>
                <ChevronRight size={12} />
                <span>02 核对分题</span>
                <ChevronRight size={12} />
                <span>03 看清步骤</span>
              </div>
            </section>
            {localDrafts.filter((d) => d.studentId === selected).length > 0 && (
              <section className="draft-section">
                <div className="section-line">
                  <h2>待上传照片</h2>
                  <span className="hint">保存在当前设备</span>
                </div>
                <div className="draft-grid">
                  {localDrafts
                    .filter((d) => d.studentId === selected)
                    .map((d) => (
                      <DraftCard
                        key={d.id}
                        draft={d}
                        uploading={uploading === d.id}
                        disabled={!!uploading}
                        onUpload={() => void upload(d)}
                        onRemove={() =>
                          void drafts
                            .remove(d.id)
                            .then(refreshDrafts)
                            .catch((e) => setError(message(e)))
                        }
                      />
                    ))}
                </div>
              </section>
            )}
            <section className="records-section">
              <div className="section-line">
                <div>
                  <h2>{student.name} 的学习资料</h2>
                  <p className="hint">原图、题目和手写步骤，都留在这里。</p>
                </div>
                <button disabled={refreshing} onClick={() => void refresh()}>
                  <RefreshCw size={16} className={refreshing ? 'spin' : ''} />{' '}
                  刷新
                </button>
              </div>
              {records.length === 0 ? (
                <div className="empty-records">
                  <FileImage size={30} />
                  <p>
                    {refreshing
                      ? '正在读取资料…'
                      : '拍下第一张作业，开始积累学习记录。'}
                  </p>
                </div>
              ) : (
                <div className="record-grid">
                  {records.map((scan) => (
                    <button
                      className="record-card"
                      key={scan.id}
                      onClick={() => setOpenScan(scan)}
                    >
                      <span className="record-icon">
                        <FileImage size={23} />
                      </span>
                      <span className="record-content">
                        <strong>{scan.originalName}</strong>
                        <small>
                          {new Date(scan.createdAt).toLocaleDateString('zh-CN')}{' '}
                          · {scan.questions.length} 道题
                        </small>
                        <span className={`status ${scan.status}`}>
                          {statusNames[scan.status] || scan.status}
                        </span>
                      </span>
                      <ChevronRight size={18} />
                    </button>
                  ))}
                </div>
              )}
              {!recognition && (
                <p className="hint">
                  识别服务未启用时，也可以保存原图、手动分题和校对。
                </p>
              )}
            </section>
          </>
        ) : (
          <div className="empty">
            <Users size={34} />
            <h2>先添加一个学生档案</h2>
            <p>每个孩子都有自己的题目、作答和学习记录。</p>
            <button className="primary" onClick={() => setAdd(true)}>
              添加第一名学生
            </button>
          </div>
        )}
        <footer><FamilyLinks /></footer>
      </main>
    </div>
  );
}
function FamilyLinks() {
  const target = Capacitor.isNativePlatform() ? '_self' : '_blank';
  return (
    <div className="family-links">
      <span>一起学 {appVersion} · 家庭试用版</span>
      <UpdateControl />
      <nav aria-label="家长与版本入口">
        <a href={`${familyWebsite}account`} target={target} rel="noopener noreferrer">家长账号</a>
        <a href={`${familyWebsite}students`} target={target} rel="noopener noreferrer">家长查看</a>
      </nav>
    </div>
  );
}
function DraftCard({
  draft,
  uploading,
  disabled,
  onUpload,
  onRemove,
}: {
  draft: Draft;
  uploading: boolean;
  disabled: boolean;
  onUpload: () => void;
  onRemove: () => void;
}) {
  const [preview, setPreview] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(draft.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [draft.file]);
  return (
    <article className="draft-card">
      <img src={preview} alt="待上传照片预览" />
      <div>
        <strong>{draft.name}</strong>
        <small>
          {(draft.file.size / 1024 / 1024).toFixed(1)} MB · 请检查清晰度和边缘
        </small>
        <div className="button-row">
          <button className="primary" disabled={disabled} onClick={onUpload}>
            {uploading ? '正在上传…' : '确认并上传'}
          </button>
          <button disabled={disabled} onClick={onRemove}>
            移除草稿
          </button>
        </div>
      </div>
    </article>
  );
}
