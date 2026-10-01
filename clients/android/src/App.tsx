import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { Camera, MediaTypeSelection } from '@capacitor/camera';
import { BookOpen } from 'lucide-react';
import { ApiError, FamilyApi, sessionExpiredEvent } from './api';
import { session } from './session';
import { drafts, listPhotoDeliveries, recoverPhotoDelivery, removePhotoDelivery, removeDamagedPhotoDelivery, type PhotoDeliveryRecord, type PhotoDeliveryIssue, type Draft } from './drafts';
import { PhotoPreparation, OriginalPhotoLibrary, photoProcessingAvailable, importOriginal, previewUrl, type OriginalPhoto } from './photo-processing/public';
import { activeCamera, beginCamera, cancelCamera, clearUnfinishedCamera, stageCamera, restoredCamera, listCameraResults, removeCameraResult, cameraResultEvent, type CameraResult } from './photo-processing/camera-handoff';
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
  const [cameraRestoreError, setCameraRestoreError] = useState('');
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
    if (!Capacitor.isNativePlatform()) return;
    // Register before authentication/child lookup: Android can restore a Camera result while Home is absent.
    const listener = NativeApp.addListener('appRestoredResult', event => {
      try { restoredCamera(event); window.dispatchEvent(new Event(cameraResultEvent)); }
      catch (e) { setCameraRestoreError(message(e)); }
    });
    return () => { void listener.then(handle => handle.remove()); };
  }, []);
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
      cameraRestoreError={cameraRestoreError}
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
  cameraRestoreError,
  initialPage,
  onUpdateAuth,
  onLogout,
}: {
  auth: Auth;
  cameraRestoreError: string;
  initialPage: HomePage;
  onUpdateAuth: (next: Auth) => Promise<string>;
  onLogout: () => Promise<void>;
}) {
  const api = useMemo(
    () => new FamilyApi(auth.base, auth.token),
    [auth.base, auth.token],
  );
  const owner = `${auth.base}|${auth.user.id}`;
  const localPhotosEnabled = photoProcessingAvailable();
  const live = useRef(true), scopeGeneration = useRef(0), uploadAbort = useRef<AbortController | null>(null);
  const [preparing, setPreparing] = useState<OriginalPhoto | null>(null), [originalsOpen, setOriginalsOpen] = useState(false);
  const [photoQueue, setPhotoQueue] = useState<PhotoDeliveryRecord[]>([]), [cameraWaiting, setCameraWaiting] = useState(false);
  const [photoQueueIssues, setPhotoQueueIssues] = useState<PhotoDeliveryIssue[]>([]);
  const importing = useRef(new Set<string>());
  const closeLocalPhotos = useCallback(() => {
    if (!live.current) return;
    scopeGeneration.current++;
    setPreparing(null); setOriginalsOpen(false); setHomePage('library'); setLibraryMode('photos');
  }, []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !originalsOpen) return;
    const listener = NativeApp.addListener('backButton', closeLocalPhotos);
    return () => { void listener.then(handle => handle.remove()); };
  }, [originalsOpen, closeLocalPhotos]);
  // Read the latest operation controller on unmount, not the controller that existed at mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; scopeGeneration.current++; uploadAbort.current?.abort(); }; }, []);
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
  const refreshPhotoQueue = useCallback(() => {
    if (!live.current || !activeStudent.current) return;
    const result = listPhotoDeliveries(owner, activeStudent.current);
    setPhotoQueue(result.records); setPhotoQueueIssues(result.issues);
  }, [owner]);
  function selectStudent(id: string) {
    if (id === activeStudent.current) return;
    scopeGeneration.current++; activeStudent.current = id; uploadAbort.current?.abort();
    setPreparing(null); setOriginalsOpen(false); setPhotoQueue([]); setPhotoQueueIssues([]); setBusy(false); setSelected(id);
  }
  useEffect(() => { if (cameraRestoreError) setError(cameraRestoreError); }, [cameraRestoreError]);
  const refreshDrafts = useCallback(async () => {
    const list = await drafts.list(owner); if (live.current) setDrafts(list);
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
        id === activeStudent.current && live.current
      ) {
        setRecords(result.scans);
        setRecognition(
          (result as { recognition?: boolean }).recognition === true,
        );
      }
    } catch (e) {
      if (generation === requestNumber.current && live.current) setError(message(e));
    } finally {
      if (generation === requestNumber.current && live.current) setRefreshing(false);
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
    try { refreshPhotoQueue(); } catch (e) { setError(message(e)); }
    void refresh();
  }, [selected, owner, refresh, refreshPhotoQueue]);
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
    async (file: Blob, studentId: string, filename: string, id: string = crypto.randomUUID()) => {
      if (!studentId) throw new Error('请先选择学生');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
        throw new Error('请使用 JPEG、PNG 或 WebP 图片');
      if (file.size > 8 * 1024 * 1024)
        throw new Error('图片超过 8 MB，请调整拍摄分辨率后重试');
      const draft: Draft = {
        id,
        owner,
        studentId,
        source: '手机拍照与导入',
        name: filename,
        file,
        createdAt: Date.now(),
      };
      await drafts.save(draft);
      await refreshDrafts();
      if (!live.current || activeStudent.current !== studentId) return;
      setNotice('照片已保存为本机草稿，确认清晰完整后上传');
      setHomePage('library');
      setLibraryMode('photos');
      window.scrollTo({ top: 0 });
    },
    [owner, refreshDrafts],
  );
  const importCameraResult = useCallback(async (result: CameraResult) => {
    if (result.owner !== owner || importing.current.has(result.id)) return;
    importing.current.add(result.id);
    const generation = scopeGeneration.current;
    try {
      if (photoProcessingAvailable()) {
        if (!result.uri) throw new Error('相机未返回原生照片地址，原照片尚未导入，请重新选择');
        const original = await importOriginal(result.owner, result.uri, result.studentId);
        removeCameraResult(result);
        if (live.current && generation === scopeGeneration.current && activeStudent.current === result.studentId) {
          setPreparing(original); setOriginalsOpen(false);
        }
      } else {
        if (!result.webPath) throw new Error('相机未返回可读取的照片');
        const response = await fetch(result.webPath); if (!response.ok) throw new Error('无法读取相机照片');
        const blob = await response.blob();
        await savePhoto(blob, result.studentId, `作业-${Date.now()}.${blob.type.split('/')[1] || 'jpg'}`, result.id);
        removeCameraResult(result);
      }
    } finally { importing.current.delete(result.id); }
  }, [owner, savePhoto]);
  const recoverCamera = useCallback(async () => {
    if (!Capacitor.isNativePlatform() || !activeStudent.current || !students.some(s => s.id === activeStudent.current)) return;
    const id = activeStudent.current, generation = scopeGeneration.current;
    try {
      try { setCameraWaiting(activeCamera()?.owner === owner); }
      catch { setCameraWaiting(true); setError('上次相机操作记录不完整，可在题目资料中取消该操作后重新拍照；已保存原片不会删除。'); }
      const { results, issues } = listCameraResults(owner, id);
      if (issues.length) setError(issues.join(' '));
      if (results.length) setBusy(true);
      for (const result of results) {
        if (!live.current || generation !== scopeGeneration.current) break;
        await importCameraResult(result);
      }
    } catch(e) { if (live.current && generation === scopeGeneration.current) setError(`上次照片尚未读取：${message(e)}`); }
    finally { if (live.current && generation === scopeGeneration.current) { setBusy(false); try { setCameraWaiting(activeCamera()?.owner === owner); } catch { setCameraWaiting(true); } } }
  }, [owner, students, importCameraResult]);
  useEffect(() => {
    void recoverCamera();
    const listener = () => void recoverCamera(); window.addEventListener(cameraResultEvent, listener);
    return () => window.removeEventListener(cameraResultEvent, listener);
  }, [selected, recoverCamera]);
  async function capture(source: 'camera' | 'gallery') {
    if (!student || busy) return;
    setError('');
    captureStudent.current = student.id;
    if (!Capacitor.isNativePlatform()) {
      (source === 'camera' ? cameraInput : galleryInput).current?.click();
      return;
    }
    const generation = scopeGeneration.current;
    let context: ReturnType<typeof beginCamera> | null = null;
    let cameraReturned = false;
    setBusy(true);
    try {
      context = beginCamera(owner, student.id, source);
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
      cameraReturned = true;
      if (!photo) { cancelCamera(context); return; }
      const result = stageCamera(context, photo);
      await importCameraResult(result);
    } catch (e) {
      const failure = cameraReturned || !context ? message(e) : captureFailure(e, source);
      if (failure && live.current && generation === scopeGeneration.current) setError(failure);
      if (context) cancelCamera(context);
    } finally {
      if (live.current && generation === scopeGeneration.current) setBusy(false);
    }
  }
  async function uploadPhoto(record: PhotoDeliveryRecord) {
    if (uploading || record.owner !== owner || record.studentId !== activeStudent.current) return;
    const generation = scopeGeneration.current, abort = new AbortController(); uploadAbort.current = abort;
    setUploading(record.id); setError('');
    const current = () => live.current && generation === scopeGeneration.current && record.studentId === activeStudent.current;
    try {
      const delivery = await recoverPhotoDelivery(record, owner, record.studentId, abort.signal);
      if (!current()) return;
      const { scan } = await api.uploadProcessed(delivery, abort.signal);
      if (!current()) return;
      // API has checked every processing field as well as student/hash/output ID before acknowledging.
      removePhotoDelivery(owner, record.studentId, record.id); refreshPhotoQueue();
      setRecords(list => [scan, ...list.filter(r => r.id !== scan.id)]);
      setNotice('处理图已保存到家庭服务器，原片仍保留在本机。可以打开照片继续框题。');
    } catch(e) { if (current()) setError(`上传未确认，待提交照片已保留：${message(e)}`); }
    finally { if (uploadAbort.current === abort) { uploadAbort.current = null; if (live.current) setUploading(''); } }
  }
  async function upload(draft: Draft) {
    if (uploading || draft.owner !== owner || draft.studentId !== activeStudent.current) return;
    const generation = scopeGeneration.current;
    setUploading(draft.id);
    setError('');
    try {
      const { scan } = await api.upload(draft);
      if (!live.current || generation !== scopeGeneration.current) return;
      await drafts.remove(draft.id);
      await refreshDrafts();
      if (activeStudent.current === draft.studentId) {
        setRecords((list) => [scan, ...list.filter((r) => r.id !== scan.id)]);
        setNotice('原图已保存。打开照片，框选题目后再选择科目。');
      }
    } catch (e) {
      if (live.current && generation === scopeGeneration.current) setError(`上传未完成，草稿已保留：${message(e)}`);
    } finally {
      if (live.current) setUploading('');
    }
  }
  const updateScan = useCallback(
    (scan: Scan) =>
      setRecords((list) => list.map((r) => (r.id === scan.id ? scan : r))),
    [],
  );
  const viewGeneration = scopeGeneration.current;
  if (preparing && preparing.studentId === selected) return <PhotoPreparation owner={owner} studentId={selected} studentLabel={student?.name}
    original={preparing} onCancel={closeLocalPhotos}
    onConfirm={delivery => {
      if (!live.current || viewGeneration !== scopeGeneration.current || delivery.record.owner !== owner || delivery.record.studentId !== activeStudent.current) return;
      refreshPhotoQueue(); setPreparing(null); setHomePage('library'); setLibraryMode('photos');
      setNotice('处理图已保存为本机待提交。检查后点击上传；原片仍保留。');
    }} />;
  if (originalsOpen && student) return <main><div className="button-row"><button onClick={closeLocalPhotos}>返回题目资料</button></div>
    <OriginalPhotoLibrary owner={owner} studentId={selected} studentLabel={student.name} onResume={original => {
      if (live.current && viewGeneration === scopeGeneration.current && original.studentId === activeStudent.current) { setOriginalsOpen(false); setPreparing(original); }
    }} /></main>;
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
      processedCount={photoQueue.length + photoQueueIssues.length} onOpenOriginals={localPhotosEnabled ? () => setOriginalsOpen(true) : undefined}
      processedPending={<>{photoQueue.map(record => <PreparedDraftCard key={record.id} record={record} uploading={uploading === record.id} disabled={!!uploading}
        onUpload={() => void uploadPhoto(record)} onRemove={() => { try { removePhotoDelivery(owner, selected, record.id); refreshPhotoQueue(); } catch(e) { setError(message(e)); } }} />)}
        {photoQueueIssues.map(issue => <article key={issue.key} className="draft-card"><div><strong>待提交记录 {issue.id.slice(0, 8)}</strong><p role="alert">{issue.message}</p>
          <div className="button-row"><button onClick={() => setOriginalsOpen(true)}>从本机原片重新处理</button>
            <button disabled={!!uploading} onClick={() => { try { removeDamagedPhotoDelivery(owner, selected, issue.key); refreshPhotoQueue(); } catch(e) { setError(message(e)); } }}>移除这条损坏记录，保留原片</button></div></div></article>)}</>}
      cameraRecovery={Capacitor.isNativePlatform() ? <div className="button-row"><button disabled={busy} onClick={() => void recoverCamera()}>读取上次相机照片</button>
        {cameraWaiting && <button disabled={busy} onClick={() => { try { clearUnfinishedCamera(owner); setCameraWaiting(false); } catch(e) { setError(message(e)); } }}>取消未完成的相机操作</button>}</div> : null}
      recognition={recognition} error={error || cameraRestoreError} notice={notice}
      onSelect={selectStudent} onCapture={(source) => void capture(source)} onRefresh={() => { void refresh(); try { refreshPhotoQueue(); } catch(e) { setError(message(e)); } }}
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
          setStudents((list) => [...list, added]); selectStudent(added.id);
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
function PreparedDraftCard({ record, uploading, disabled, onUpload, onRemove }: {
  record: PhotoDeliveryRecord; uploading: boolean; disabled: boolean; onUpload: () => void; onRemove: () => void;
}) {
  return <article className="draft-card"><img src={previewUrl(record.prepared)} alt="已确认的处理图" />
    <div><strong>处理图 · {new Date(record.confirmedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</strong>
      <small>{(record.prepared.bytes / 1024 / 1024).toFixed(1)} MiB · 尚未确认上传成功 · 原片保留在本机</small>
      <details className="photo-prep-detail"><summary>查看待提交照片</summary><div><img src={previewUrl(record.prepared)} alt="待提交处理图放大查看" /></div></details>
      <div className="button-row"><button className="primary" disabled={disabled} onClick={onUpload}>{uploading ? '正在上传…' : '上传处理图'}</button>
        <button disabled={disabled} onClick={onRemove}>移除待提交，保留原片</button></div></div></article>;
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
      {preview && <img src={preview} alt="待上传照片预览" />}
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
