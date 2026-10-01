import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { Camera, MediaTypeSelection } from '@capacitor/camera';
import { BookOpen } from 'lucide-react';
import { ApiError, FamilyApi, sessionExpiredEvent } from './api';
import { session } from './session';
import { drafts, type Draft } from './drafts';
import { Review } from './Review';
import { type Scan, type Student } from './types';
import { appName, appVersion, familyWebsite } from './release';
import { restoreSession, type Auth } from './restore-session';
import { UpdateControl } from './UpdateControl';
import { HomeView, type HomePage } from './HomeView';
import { captureFailure } from './permissions';
import { AuthForm, type AuthMode } from './AuthForm';
import { GuestHome } from './GuestHome';
import { pageNames } from './BottomNavigation';

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
  const [authPage, setAuthPage] = useState<{ mode: AuthMode; feature?: string } | null>(null);
  const [guestPage, setGuestPage] = useState<HomePage>('home');
  const liveAuth = useRef(auth);
  liveAuth.current = auth;
  useEffect(() => {
    const expired = (event: Event) => {
      const source = (event as CustomEvent<{ base: string; token: string }>)
        .detail;
      const active = liveAuth.current;
      if (!active || source.base !== active.base || source.token !== active.token)
        return;
      void session.clear().catch(() => {});
      setAuth(null);
      setAuthPage({ mode: 'login' });
      setError('登录已过期，请重新登录。未完成的本机草稿仍然保留。');
    };
    window.addEventListener(sessionExpiredEvent, expired);
    return () => window.removeEventListener(sessionExpiredEvent, expired);
  }, []);
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
            setAuthPage({ mode: 'login' });
          }}>换账号登录</button>
          <button onClick={() => setRestoreError('')}>先逛逛</button>
        </div>
        <FamilyLinks />
      </main>
    );
  if (!auth) {
    if (!authPage) return <GuestHome page={guestPage} onNavigate={setGuestPage} onAuth={(mode, feature) => setAuthPage({ mode, feature })} />;
    return (
      <AuthForm
        initialMode={authPage.mode}
        feature={authPage.feature}
        backLabel={`返回${pageNames[guestPage]}`}
        onBack={() => { setAuthPage(null); setError(''); }}
        initialError={error}
        onLogin={async (next) => {
          await session.save(
            JSON.stringify({ base: next.base, token: next.token }),
          );
          setError('');
          setAuthPage(null);
          setAuth(next);
        }}
      ><FamilyLinks /></AuthForm>
    );
  }
  return (
    <Home
      key={`${auth.base}|${auth.user.id}`}
      auth={auth}
      initialPage={guestPage}
      onUpdateAuth={async (next) => {
        liveAuth.current = next;
        setAuth(next);
        try { await session.save(JSON.stringify({ base: next.base, token: next.token })); return ''; }
        catch { return '修改已生效。本次登录仍可使用，但未能保存登录状态，下次打开请用新信息登录。'; }
      }}
      onLogout={async () => {
        await session.clear();
        setAuth(null);
        setAuthPage(null);
      }}
    />
  );
}

function Home({
  auth,
  initialPage,
  onUpdateAuth,
  onLogout,
}: {
  auth: Auth;
  initialPage: HomePage;
  onUpdateAuth: (next: Auth) => Promise<string>;
  onLogout: () => Promise<void>;
}) {
  const api = useMemo(
    () => new FamilyApi(auth.base, auth.token),
    [auth.base, auth.token],
  );
  const owner = `${auth.base}|${auth.user.id}`;
  const [homePage, setHomePage] = useState<HomePage>(initialPage);
  const [libraryMode, setLibraryMode] = useState<'photos' | 'wrong'>('photos');
  const [openQuestion, setOpenQuestion] = useState('');
  const [students, setStudents] = useState<Student[]>([]),
    [selected, setSelected] = useState(readSetting(selectionKey(owner)));
  const [records, setRecords] = useState<Scan[]>([]),
    [localDrafts, setDrafts] = useState<Draft[]>([]),
    [openScan, setOpenScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
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
      !records.some((r) => ['queued', 'processing'].includes(r.status) || r.questions.some((q) => ['queued', 'processing'].includes(q.tutoring?.status || ''))) ||
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
      setHomePage('library');
      setLibraryMode('photos');
      window.scrollTo({ top: 0 });
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
              includeMetadata: false,
              saveToGallery: false,
            })
          : (
              await Camera.chooseFromGallery({
                allowMultipleSelection: false,
                mediaType: MediaTypeSelection.Photo,
                includeMetadata: false,
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
      const failure = captureFailure(e, source);
      if (failure) setError(failure);
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
        setNotice('原图已保存。打开照片，框选题目后再选择科目。');
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
        selectedQuestionId={openQuestion}
        onBack={() => {
          setOpenScan(null);
          void refresh();
        }}
        onUpdate={updateScan}
      />
    );
  return <>
    <HomeView username={auth.user.username} students={students} selected={selected} records={records}
      onUpdateAccount={async (kind, value, currentPassword) => {
        const next = kind === 'username' ? await api.changeUsername(value, currentPassword) : await api.changePassword(value, currentPassword);
        if (next.user.id !== auth.user.id) throw new Error('账号信息不匹配，请重新登录。');
        return onUpdateAuth({ base: auth.base, token: next.token, user: next.user });
      }}
      page={homePage} onNavigate={setHomePage}
      libraryMode={libraryMode} onLibraryMode={setLibraryMode}
      localDrafts={localDrafts} busy={busy} uploading={uploading} refreshing={refreshing}
      recognition={recognition} error={error} notice={notice}
      onSelect={setSelected} onCapture={(source) => void capture(source)} onRefresh={() => void refresh()}
      onOpenScan={(scan, questionId) => { setOpenQuestion(questionId || ''); setOpenScan(scan); }}
      onLogout={() => void (async () => {
        try { setBusy(true); await api.logout(); await onLogout(); }
        catch (e) { setError(`退出未完成：${message(e)}`); }
        finally { setBusy(false); }
      })()}
      onAddStudent={async (name, grade) => {
        if (busy) return false;
        setBusy(true); setError('');
        try {
          const { student: added } = await api.addStudent(name, grade);
          setStudents((list) => [...list, added]); setSelected(added.id);
          return true;
        } catch (e) { setError(message(e)); return false; }
        finally { setBusy(false); }
      }}
      renderDraft={(draft) => <DraftCard key={draft.id} draft={draft} uploading={uploading === draft.id}
        disabled={!!uploading} onUpload={() => void upload(draft)}
        onRemove={() => void drafts.remove(draft.id).then(refreshDrafts).catch((e) => setError(message(e)))} />}
    ><FamilyLinks /></HomeView>
    <input className="visually-hidden" ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void savePhoto(file, captureStudent.current, file.name).catch((err) => setError(message(err)));
        e.target.value = '';
      }} />
    <input className="visually-hidden" ref={galleryInput} type="file" accept="image/jpeg,image/png,image/webp"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void savePhoto(file, captureStudent.current, file.name).catch((err) => setError(message(err)));
        e.target.value = '';
      }} />
  </>;
}

function FamilyLinks() {
  const target = Capacitor.isNativePlatform() ? '_self' : '_blank';
  return (
    <div className="family-links">
      <span>{appName} {appVersion} · 家庭试用版</span>
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
