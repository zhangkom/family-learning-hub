import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { Camera, MediaTypeSelection } from '@capacitor/camera';
import { BookOpen } from 'lucide-react';
import { ApiError, FamilyApi, sessionExpiredEvent } from './api';
import { session } from './session';
import { drafts, listPhotoDeliveries, recoverPhotoDelivery, removePhotoDelivery, removeDamagedPhotoDelivery, type PhotoDeliveryRecord, type PhotoDeliveryIssue, type Draft } from './drafts';
import { PhotoPreparation, OriginalPhotoLibrary, photoProcessingAvailable, importOriginal, previewUrl, pickOriginals, listOriginalBatches, resumeOriginalBatch, getOriginalBatch, forgetOriginalBatch, type OriginalPhoto } from './photo-processing/public';
import { CloudPhotoDrive } from './cloud-drive/CloudPhotoDrive';
import { activeCamera, beginCamera, cancelCamera, clearUnfinishedCamera, stageCamera, restoredCamera, listCameraResults, removeCameraResult, cameraResultEvent, type CameraResult } from './photo-processing/camera-handoff';
import { Review } from './Review';
import { LearningHub, type LearningView } from './LearningHub';
import { type Scan, type Student, type StudentOverviewReply } from './types';
import { appName, appVersion } from './release';
import { restoreSession, type Auth } from './restore-session';
import { UpdateControl } from './UpdateControl';
import { HomeView, type HomePage } from './HomeView';
import type { LibraryMode, LibraryContext } from './QuestionLibrary';
import { captureFailure } from './permissions';
import { AuthForm, type AuthMode } from './AuthForm';
import { GuestHome } from './GuestHome';
import { pageNames } from './BottomNavigation';
import { CaptureBatch, collectionSize, type CaptureCollection } from './CaptureBatch';
import { runPhotoBatch, type BatchProgress } from './batch-upload';
import { isHostedWeb } from './hosted-web';
import { WebAppInfo } from './WebAppInfo';
import { recoveredImages } from './photo-processing/recovered-image';
import { readWebLocation, useHostedWebNavigation } from './web-navigation';

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
  const [guestPage, setGuestPage] = useState<HomePage>(() => isHostedWeb ? readWebLocation().page : 'home');
  const guestNavigation = useHostedWebNavigation();
  useEffect(() => { if (isHostedWeb) setGuestPage(guestNavigation.route.page); }, [guestNavigation.route]);
  const liveAuth = useRef(auth);
  liveAuth.current = auth;
  useEffect(() => {
    if (!isHostedWeb || !auth) return;
    // Another tab may log in as a different family. Revalidate before showing cached records again.
    let alive = true;
    const check = () => {
      if (document.visibilityState === 'hidden') return;
      void new FamilyApi(auth.base, auth.token).me().then(result => {
        if (alive && result.user.id !== auth.user.id) setAuth({ ...auth, ...result });
      }).catch(() => {});
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => { alive = false; window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [auth]);
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
    if (!authPage) return <GuestHome page={guestPage} onNavigate={page => { setGuestPage(page); if (isHostedWeb) guestNavigation.navigate({ page }); }} onAuth={(mode, feature) => setAuthPage({ mode, feature })} />;
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
  const [cameraFailures, setCameraFailures] = useState<{ result: CameraResult; message: string }[]>([]);
  const [collection, setCollection] = useState<CaptureCollection | null>(null);
  const collectionRef = useRef<CaptureCollection | null>(null);
  const [preparationBatch, setPreparationBatch] = useState<{ photos: OriginalPhoto[]; index: number; nativeBatchIds: string[] } | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [captureProgress, setCaptureProgress] = useState('');
  const captureBusy = useRef(false);
  const captureAbort = useRef<AbortController | null>(null);
  function updateCollection(next: CaptureCollection | null) { collectionRef.current = next; setCollection(next); }
  const importing = useRef(new Set<string>());
  const closeLocalPhotos = useCallback(() => {
    if (!live.current) return;
    scopeGeneration.current++;
    captureAbort.current?.abort(); setBusy(false);
    collectionRef.current = null; setCollection(null); setPreparationBatch(null);
    setPreparing(null); setOriginalsOpen(false); setHomePage('home');
  }, []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || (!originalsOpen && !collection)) return;
    const listener = NativeApp.addListener('backButton', closeLocalPhotos);
    return () => { void listener.then(handle => handle.remove()); };
  }, [originalsOpen, collection, closeLocalPhotos]);
  // Read the latest operation controller on unmount, not the controller that existed at mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; scopeGeneration.current++; uploadAbort.current?.abort(); captureAbort.current?.abort(); }; }, []);
  const [homePage, setHomePage] = useState<HomePage>(initialPage);
  const [learningView, setLearningView] = useState<LearningView | null>(null);
  const { route: webRoute, navigate: webNavigate } = useHostedWebNavigation();
  const [learningRevision, setLearningRevision] = useState(0);
  const [libraryMode, setLibraryMode] = useState<LibraryMode>('wrong');
  const libraryModeRef = useRef(libraryMode);
  libraryModeRef.current = libraryMode;
  // Home survives source details and learning views; the account-keyed parent isolates accounts.
  const [libraryContext, setLibraryContext] = useState<LibraryContext>({ subject: '全部', order: 'newest', dimension: '' });
  const [studentOverview, setStudentOverview] = useState<StudentOverviewReply | null>(null);
  const [overviewError, setOverviewError] = useState('');
  const [overviewRevision, setOverviewRevision] = useState(0);
  const [openQuestion, setOpenQuestion] = useState('');
  const [lastViewed, setLastViewed] = useState<Record<string, { scanId: string; questionId?: string }>>({});
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
  const [recordsStudent, setRecordsStudent] = useState('');
  function navigatePage(page: HomePage) {
    setHomePage(page);
    if (isHostedWeb) webNavigate({ page, libraryMode: libraryModeRef.current });
  }
  function navigateMode(mode: LibraryMode) {
    libraryModeRef.current = mode; setLibraryMode(mode);
    if (isHostedWeb && homePage === 'library') webNavigate({ page: 'library', libraryMode: mode });
  }
  function openLearning(view: LearningView) {
    setOpenScan(null); setLearningView(view);
    if (isHostedWeb) webNavigate({ page: homePage, libraryMode: libraryModeRef.current, learning: view });
  }
  function openReview(scan: Scan, questionId?: string) {
    setLastViewed(previous => ({ ...previous, [scan.studentId]: { scanId: scan.id, questionId } }));
    setOpenQuestion(questionId || ''); setOpenScan(scan);
    if (isHostedWeb) webNavigate({ page: homePage, libraryMode: libraryModeRef.current, overlay: { kind: 'review', scanId: scan.id, questionId } });
  }
  function closeWebOverlay() {
    if (isHostedWeb) webNavigate({ page: homePage, libraryMode: libraryModeRef.current }, { replace: true });
  }
  useEffect(() => {
    if (!isHostedWeb) return;
    const route = webRoute;
    setHomePage(route.page);
    if (route.libraryMode) { libraryModeRef.current = route.libraryMode; setLibraryMode(route.libraryMode); }
    setLearningView(route.learning || null);
    setCloudOpen(route.overlay?.kind === 'cloud');
    if (route.overlay?.kind !== 'review') setOpenScan(null);
    if (route.overlay?.kind !== 'capture') {
      captureAbort.current?.abort(); collectionRef.current = null; setCollection(null); setPreparing(null); setPreparationBatch(null);
    }
  }, [webRoute]);
  useEffect(() => {
    if (!isHostedWeb || webRoute.overlay?.kind !== 'review' || recordsStudent !== selected) return;
    const target = webRoute.overlay;
    const scan = records.find(item => item.id === target.scanId && item.studentId === selected);
    if (scan) { setOpenScan(scan); setOpenQuestion(target.questionId || ''); }
    else { setError('当前学生没有这张题目照片，请检查所选学生。'); webNavigate({ page: 'library', libraryMode: 'photos' }, { replace: true }); }
  }, [records, recordsStudent, selected, webRoute, webNavigate]);
  useEffect(() => {
    if (homePage !== 'me') return;
    const controller = new AbortController();
    setStudentOverview(null); setOverviewError('');
    void api.studentOverview(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.students.some(item => !item.overview)) throw new Error('统计暂不可用，请稍后刷新');
      setStudentOverview(result);
    }).catch(error => { if (!controller.signal.aborted) setOverviewError(message(error)); });
    return () => controller.abort();
  }, [api, homePage, students.length, overviewRevision]);
  const refreshPhotoQueue = useCallback(() => {
    if (!live.current || !activeStudent.current) return;
    const result = listPhotoDeliveries(owner, activeStudent.current);
    setPhotoQueue(result.records); setPhotoQueueIssues(result.issues);
  }, [owner]);
  function selectStudent(id: string) {
    if (id === activeStudent.current) return;
    scopeGeneration.current++; activeStudent.current = id; uploadAbort.current?.abort(); captureAbort.current?.abort();
    setRecords([]); setLearningView(null);
    setRecordsStudent('');
    if (isHostedWeb) webNavigate({ page: homePage, libraryMode: libraryModeRef.current }, { replace: true });
    setLibraryContext({ subject: '全部', order: 'newest', dimension: '' });
    updateCollection(null); setPreparationBatch(null); setBatchProgress(null); setCloudOpen(false);
    setPreparing(null); setOriginalsOpen(false); setPhotoQueue([]); setPhotoQueueIssues([]); setCameraFailures([]); setBusy(false); setSelected(id);
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
        setRecordsStudent(id);
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
        source: isHostedWeb ? '网页选图与导入' : '手机拍照与导入',
        name: filename,
        file,
        createdAt: Date.now(),
      };
      await drafts.save(draft);
      const batch = collectionRef.current;
      if (live.current && batch?.studentId === studentId && !batch.drafts.some(item => item.id === id)) {
        const next = { ...batch, drafts: [...batch.drafts, draft] }; collectionRef.current = next; setCollection(next);
      }
      await refreshDrafts();
      if (!live.current || activeStudent.current !== studentId) return;
      setNotice('照片已保存为本机草稿，确认清晰完整后上传');
      setHomePage('home');
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
          const batch = collectionRef.current;
          if (batch?.studentId === result.studentId) {
            if (!batch.originals.some(item => item.originalId === original.originalId)) {
              const next = { ...batch, originals: [...batch.originals, original] }; collectionRef.current = next; setCollection(next);
            }
          } else { setPreparing(original); setOriginalsOpen(false); }
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
      const failures: { result: CameraResult; message: string }[] = [];
      for (const result of results) {
        if (!live.current || generation !== scopeGeneration.current) break;
        try { await importCameraResult(result); }
        catch(e) { failures.push({ result, message: message(e) }); }
      }
      if (live.current && generation === scopeGeneration.current) setCameraFailures(failures);
    } catch(e) { if (live.current && generation === scopeGeneration.current) setError(`上次照片尚未读取：${message(e)}`); }
    finally { if (live.current && generation === scopeGeneration.current) { setBusy(false); try { setCameraWaiting(activeCamera()?.owner === owner); } catch { setCameraWaiting(true); } } }
  }, [owner, students, importCameraResult]);
  useEffect(() => {
    void recoverCamera();
    const listener = () => void recoverCamera(); window.addEventListener(cameraResultEvent, listener);
    return () => window.removeEventListener(cameraResultEvent, listener);
  }, [selected, recoverCamera]);
  async function capture(source: 'camera' | 'gallery' | 'folder') {
    if (!student || busy || captureBusy.current || uploadAbort.current) return;
    setError(''); setCaptureProgress('');
    const batch = collectionRef.current ?? { studentId: student.id, originals: [], drafts: [] };
    if (batch.studentId !== student.id) { setError('照片归属已变化，请重新选择学生'); return; }
    updateCollection(batch);
    captureStudent.current = student.id;
    if (!Capacitor.isNativePlatform()) {
      (source === 'camera' ? cameraInput : galleryInput).current?.click();
      if (isHostedWeb) webNavigate({ page: homePage, overlay: { kind: 'capture' } });
      return;
    }
    const generation = scopeGeneration.current;
    const abort = new AbortController(); captureAbort.current = abort;
    let context: ReturnType<typeof beginCamera> | null = null;
    let cameraReturned = false;
    setBusy(true); captureBusy.current = true;
    try {
      if ((source === 'gallery' || source === 'folder') && localPhotosEnabled) {
        const result = await pickOriginals(owner, student.id, 2147483647, { purpose: 'processed', signal: abort.signal, folderRange: source === 'folder', albumRange: source === 'gallery',
          onProgress: progress => { if (live.current && generation === scopeGeneration.current) setCaptureProgress(`正在导入相册：已处理 ${progress.items.filter(item => item.status !== 'pending').length} / ${progress.items.length} 张`); } });
        if (live.current && generation === scopeGeneration.current && activeStudent.current === student.id) {
          const current = collectionRef.current;
          if (current?.studentId === student.id) updateCollection({ ...current, originals: [...current.originals, ...result.originals.filter(photo => !current.originals.some(old => old.originalId === photo.originalId))],
            nativeBatchIds: [...(current.nativeBatchIds || []), ...(result.batchId ? [result.batchId] : [])] });
          if (result.failures.length) setError(`${result.failures.length} 张未导入：${result.failures.map(item => item.message).join('；')}`);
        }
        return;
      }
      if (source === 'folder') throw new Error('请更新应用后使用按文件夹选范围');
      context = beginCamera(owner, student.id, source);
      const photos =
        source === 'camera'
          ? [await Camera.takePhoto({
              quality: 95,
              includeMetadata: false,
              saveToGallery: false,
            })]
          : (
              await Camera.chooseFromGallery({
                allowMultipleSelection: true,
                mediaType: MediaTypeSelection.Photo,
                includeMetadata: false,
              })
            ).results;
      cameraReturned = true;
      if (!photos.length) { cancelCamera(context); return; }
      const results = photos.map((photo, index) => stageCamera(index ? { ...context!, id: crypto.randomUUID() } : context!, photo));
      const failures: string[] = [];
      for (const result of results) {
        if (!live.current || generation !== scopeGeneration.current) break;
        try { await importCameraResult(result); } catch (e) { failures.push(message(e)); }
      }
      if (failures.length && live.current && generation === scopeGeneration.current) setError(`${failures.length} 张未读取，引用已保留，可重试：${failures.join('；')}`);
    } catch (e) {
      const failure = cameraReturned || !context ? message(e) : captureFailure(e, source === 'folder' ? 'gallery' : source);
      if (failure && live.current && generation === scopeGeneration.current) setError(failure);
      if (context) cancelCamera(context);
    } finally {
      captureBusy.current = false;
      if (captureAbort.current === abort) captureAbort.current = null;
      if (live.current && generation === scopeGeneration.current) setBusy(false);
    }
  }
  async function saveBrowserBatch(files: File[]) {
    const id = captureStudent.current, generation = scopeGeneration.current, batch = collectionRef.current;
    if (!batch || batch.studentId !== id || captureBusy.current) return;
    captureBusy.current = true; setBusy(true); setError(''); const failures: string[] = [];
    try {
      for (const file of files) {
        if (!live.current || generation !== scopeGeneration.current) break;
        try { await savePhoto(file, id, file.name); } catch (e) { failures.push(`${file.name}：${message(e)}`); }
      }
      if (live.current && generation === scopeGeneration.current && failures.length) setError(failures.join('；'));
    } finally { captureBusy.current = false; if (live.current && generation === scopeGeneration.current) setBusy(false); }
  }
  function finishCollection() {
    const batch = collectionRef.current; if (!batch || busy || !collectionSize(batch)) return;
    updateCollection(null); setHomePage('home');
    if (isHostedWeb) webNavigate({ page: 'home' }, { replace: true });
    if (batch.originals.length) { setPreparationBatch({ photos: batch.originals, index: 0, nativeBatchIds: batch.nativeBatchIds || [] }); setPreparing(batch.originals[0]); }
    else setNotice(`${batch.drafts.length} 张照片已保存为本机草稿，可检查后批量上传。`);
  }
  async function removeCollectedPhoto(id: string) {
    const batch = collectionRef.current, generation = scopeGeneration.current;
    if (!batch || busy) return;
    setBusy(true);
    try {
      if (batch.drafts.some(item => item.id === id)) { await drafts.remove(id); await refreshDrafts(); }
      if (live.current && generation === scopeGeneration.current && collectionRef.current === batch)
        updateCollection({ ...batch, originals: batch.originals.filter(item => item.originalId !== id), drafts: batch.drafts.filter(item => item.id !== id) });
    } catch (e) { if (live.current && generation === scopeGeneration.current) setError(message(e)); }
    finally { if (live.current && generation === scopeGeneration.current) setBusy(false); }
  }
  async function advancePreparation() {
    if (preparationBatch && preparationBatch.index + 1 < preparationBatch.photos.length) {
      const next = { ...preparationBatch, index: preparationBatch.index + 1 }; setPreparationBatch(next); setPreparing(next.photos[next.index]);
    } else {
      const generation = scopeGeneration.current; setBusy(true);
      try {
        for (const batchId of preparationBatch?.nativeBatchIds || []) {
          if (!live.current || generation !== scopeGeneration.current) break;
          const batch = await getOriginalBatch(owner, selected, batchId);
          if (batch.state === 'completed' || batch.state === 'cancelled') await forgetOriginalBatch(owner, selected, batchId);
        }
      } catch (e) { if (live.current && generation === scopeGeneration.current) setError(`照片已保存；相册批次收尾未完成：${message(e)}`); }
      finally {
        if (live.current && generation === scopeGeneration.current) { setBusy(false); setPreparationBatch(null); setPreparing(null); setHomePage('home'); }
      }
    }
  }
  async function recoverGallery() {
    if (!student || busy || captureBusy.current || uploadAbort.current) return;
    const generation = scopeGeneration.current, abort = new AbortController(); captureAbort.current = abort; captureBusy.current = true; setBusy(true); setError('');
    try {
      const saved = await listOriginalBatches(owner, student.id, 'processed');
      // The native list contains references only; import one item at a time when explicitly resumed.
      const originals: OriginalPhoto[] = []; const failures: string[] = []; const nativeBatchIds: string[] = [];
      for (const batch of saved.batches) {
        if (!live.current || generation !== scopeGeneration.current) break;
        if (batch.state === 'cancelled' || batch.state === 'selecting') continue;
        const result = await resumeOriginalBatch(owner, student.id, batch.batchId, { signal: abort.signal });
        for (const original of result.originals) if (!originals.some(item => item.originalId === original.originalId)) originals.push(original);
        failures.push(...result.failures.map(item => item.message)); nativeBatchIds.push(batch.batchId);
      }
      if (!live.current || generation !== scopeGeneration.current) return;
      if (originals.length) updateCollection({ studentId: student.id, originals, drafts: [], nativeBatchIds });
      else setNotice('没有待恢复的相册选择；已经保存的照片可从“本机原片”继续处理。');
      if (failures.length) setError(failures.join('；'));
    } catch (e) { if (live.current && generation === scopeGeneration.current) setError(message(e)); }
    finally { captureBusy.current = false; if (captureAbort.current === abort) captureAbort.current = null; if (live.current && generation === scopeGeneration.current) setBusy(false); }
  }
  async function uploadPhoto(record: PhotoDeliveryRecord) {
    if (uploadAbort.current || uploading || record.owner !== owner || record.studentId !== activeStudent.current) return;
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
    if (uploadAbort.current || uploading || draft.owner !== owner || draft.studentId !== activeStudent.current) return;
    const generation = scopeGeneration.current, abort = new AbortController(); uploadAbort.current = abort;
    setUploading(draft.id);
    setError('');
    try {
      const { scan } = await api.upload(draft, abort.signal);
      if (!live.current || generation !== scopeGeneration.current) return;
      if (isHostedWeb) await recoveredImages.save(owner, scan, draft.file, abort.signal);
      await drafts.remove(draft.id);
      await refreshDrafts();
      if (activeStudent.current === draft.studentId) {
        setRecords((list) => [scan, ...list.filter((r) => r.id !== scan.id)]);
        setNotice('原图已保存。打开照片，框选题目后再选择科目。');
      }
    } catch (e) {
      if (live.current && generation === scopeGeneration.current) setError(`上传未完成，草稿已保留：${message(e)}`);
    } finally {
      if (uploadAbort.current === abort) { uploadAbort.current = null; if (live.current) setUploading(''); }
    }
  }
  async function uploadMany() {
    if (uploadAbort.current || busy || !student) return;
    const studentId = student.id, generation = scopeGeneration.current;
    type Item = { id: string; prepared?: PhotoDeliveryRecord; draft?: Draft };
    const items: Item[] = [
      ...photoQueue.filter(item => item.owner === owner && item.studentId === studentId).map(prepared => ({ id: prepared.id, prepared })),
      ...localDrafts.filter(item => item.owner === owner && item.studentId === studentId).map(draft => ({ id: draft.id, draft })),
    ];
    if (!items.length) return;
    const abort = new AbortController(); uploadAbort.current = abort; setUploading('batch'); setError('');
    const current = () => live.current && generation === scopeGeneration.current && activeStudent.current === studentId;
    try {
      const progress = await runPhotoBatch(items, async (item, signal) => {
        signal.throwIfAborted();
        const result = item.prepared
          ? await api.uploadProcessed(await recoverPhotoDelivery(item.prepared, owner, studentId, signal), signal)
          : await api.upload(item.draft!, signal);
        signal.throwIfAborted();
        if (!current()) throw new DOMException('学生或账号已变化', 'AbortError');
        if (result.scan.studentId !== studentId) throw new Error('上传回执的学生归属不匹配，待提交项已保留');
        if (item.prepared) { removePhotoDelivery(owner, studentId, item.id); refreshPhotoQueue(); }
        else {
          if (isHostedWeb) await recoveredImages.save(owner, result.scan, item.draft!.file, signal);
          await drafts.remove(item.id); await refreshDrafts();
        }
        if (current()) setRecords(list => [result.scan, ...list.filter(scan => scan.id !== result.scan.id)]);
      }, abort.signal, progress => { if (current()) setBatchProgress(progress); });
      if (current()) setNotice(`${progress.stopped ? '本批已停止' : '本批上传结束'}：成功 ${progress.succeeded} 张，失败 ${progress.failed.length} 张。未确认成功的照片仍留在本机，可继续上传。`);
    } catch (e) { if (current()) setError(message(e)); }
    finally { if (uploadAbort.current === abort) { uploadAbort.current = null; if (live.current) setUploading(''); } }
  }
  const updateScan = useCallback(
    (scan: Scan) =>
      setRecords((list) => scan.studentId !== activeStudent.current ? list : list.map((r) => (r.id === scan.id && r.studentId === scan.studentId && r.revision <= scan.revision ? scan : r))),
    [],
  );
  const viewGeneration = scopeGeneration.current;
  const fileInputs = <>
    <input className="visually-hidden" ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
      onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; void saveBrowserBatch(files); }} />
    <input className="visually-hidden" ref={galleryInput} type="file" multiple accept="image/jpeg,image/png,image/webp"
      onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; void saveBrowserBatch(files); }} />
  </>;
  if (cloudOpen && student) return <CloudPhotoDrive key={`${owner}/${selected}`} api={api} owner={owner} studentId={selected} studentLabel={student.name} onClose={() => { setCloudOpen(false); closeWebOverlay(); }}
    onOpenOriginals={localPhotosEnabled ? () => { setCloudOpen(false); setOriginalsOpen(true); } : undefined} />;
  if (collection && collection.studentId === selected) return <><CaptureBatch collection={collection} studentLabel={student?.name || '当前孩子'} busy={busy} error={error} progress={captureProgress}
    onCapture={source => void capture(source)} onFolderRange={localPhotosEnabled ? () => void capture('folder') : undefined} onFinish={finishCollection} onClose={() => { closeLocalPhotos(); closeWebOverlay(); }}
    onRemove={id => void removeCollectedPhoto(id)} />{fileInputs}</>;
  if (preparing && preparing.studentId === selected) return <>
    {preparationBatch && <div className="capture-batch-progress"><strong>逐张调整 · 第 {preparationBatch.index + 1} / {preparationBatch.photos.length} 张</strong>
      <p className="hint">确认当前照片后进入下一张，全部确认后可以批量上传。</p></div>}
    <PhotoPreparation owner={owner} studentId={selected} studentLabel={student?.name}
    original={preparing} onCancel={closeLocalPhotos}
    onConfirm={async delivery => {
      if (!live.current || viewGeneration !== scopeGeneration.current || delivery.record.owner !== owner || delivery.record.studentId !== activeStudent.current) return;
      refreshPhotoQueue(); await advancePreparation();
      if (!live.current || viewGeneration !== scopeGeneration.current || delivery.record.studentId !== activeStudent.current) return;
      setNotice('处理图已保存为本机待提交。检查后点击上传；原片仍保留。');
    }} /></>;
  if (originalsOpen && student) return <main><div className="button-row"><button onClick={closeLocalPhotos}>返回首页</button></div>
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
        onLearn={(mode, scan, questionId) => openLearning({ mode, source: { scanId: scan.id, questionId } })}
        onBack={() => {
          setOpenScan(null);
          closeWebOverlay();
          void refresh();
        }}
        onUpdate={updateScan}
      />
    );
  if (learningView && student) return <LearningHub key={`${owner}/${selected}/${learningView.mode}/${learningView.sessionId || ''}`} api={api} owner={owner} studentId={selected} studentName={student.name} records={records} view={learningView}
    onClose={() => { setLearningView(null); closeWebOverlay(); setLearningRevision(x => x + 1); setOverviewRevision(x => x + 1); void refresh(); }}
    onOpenSource={(scan, questionId, sessionId) => { setLearningView({ mode: learningView.mode, source: { scanId: scan.id, questionId }, sessionId }); openReview(scan, questionId); }} onRefreshSources={() => void refresh()} />;
  return <>
    <HomeView learningRevision={learningRevision} onLearn={(mode, source, sessionId) => { if (student) openLearning({ mode, source, sessionId }); else { navigatePage('me'); setNotice('请先添加学生档案。'); } }} lastViewed={lastViewed[selected]} api={api} owner={owner} username={auth.user.username} students={students} selected={selected} records={records}
      onUpdateScan={updateScan}
      studentOverview={studentOverview} overviewError={overviewError} onRefreshOverview={() => setOverviewRevision(value => value + 1)}
      onUpdateAccount={async (kind, value, currentPassword) => {
        const next = kind === 'username' ? await api.changeUsername(value, currentPassword) : await api.changePassword(value, currentPassword);
        if (next.user.id !== auth.user.id) throw new Error('账号信息不匹配，请重新登录。');
        return onUpdateAuth({ base: auth.base, token: next.token, user: next.user, ...(next.capabilities ? { capabilities: next.capabilities } : {}) });
      }}
      page={homePage} onNavigate={navigatePage}
      libraryMode={libraryMode} onLibraryMode={navigateMode}
      libraryContext={libraryContext} onLibraryContext={setLibraryContext}
      localDrafts={localDrafts} busy={busy} uploading={uploading} refreshing={refreshing}
      processedCount={photoQueue.length + photoQueueIssues.length} onOpenOriginals={localPhotosEnabled ? () => setOriginalsOpen(true) : undefined}
      onOpenCloud={() => { setCloudOpen(true); if (isHostedWeb) webNavigate({ page: homePage, overlay: { kind: 'cloud' } }); }}
      batchUploads={(photoQueue.length + localDrafts.filter(item => item.studentId === selected).length > 0 || !!batchProgress || uploading === 'batch') ? <section className="batch-upload-panel" aria-label="拍题批量上传">
        <strong>确认上传</strong><p className="hint">原片保留在本机。</p>
        <div className="button-row">{(photoQueue.length + localDrafts.filter(item => item.studentId === selected).length > 0) && <button className="primary" disabled={busy || !!uploading} onClick={() => void uploadMany()}>
          确认并批量上传（{photoQueue.length + localDrafts.filter(item => item.studentId === selected).length} 张）</button>}
          {uploading === 'batch' && <button onClick={() => uploadAbort.current?.abort()}>停止本批上传</button>}</div>
        {batchProgress && <><output>已处理 {batchProgress.completed} / {batchProgress.total} 张 · 成功 {batchProgress.succeeded} · 失败 {batchProgress.failed.length}{batchProgress.stopped ? ' · 已停止' : ''}</output>
          <progress max={batchProgress.total} value={batchProgress.completed} />
          {!uploading && <button onClick={() => setBatchProgress(null)}>收起进度</button>}
          {!!batchProgress.failed.length && <details><summary>查看失败原因；未成功项可继续上传</summary><ul>{batchProgress.failed.map(item => <li key={item.id}>照片 {item.id.slice(0, 8)}：{item.reason}</li>)}</ul></details>}</>}
      </section> : null}
      processedPending={<>{photoQueue.map(record => <PreparedDraftCard key={record.id} record={record} uploading={uploading === record.id} disabled={!!uploading}
        onUpload={() => void uploadPhoto(record)} onRemove={() => { try { removePhotoDelivery(owner, selected, record.id); refreshPhotoQueue(); } catch(e) { setError(message(e)); } }} />)}
        {photoQueueIssues.map(issue => <article key={issue.key} className="draft-card"><div><strong>待提交记录 {issue.id.slice(0, 8)}</strong><p role="alert">{issue.message}</p>
          <div className="button-row"><button onClick={() => setOriginalsOpen(true)}>从本机原片重新处理</button>
            <button disabled={!!uploading} onClick={() => { try { removeDamagedPhotoDelivery(owner, selected, issue.key); refreshPhotoQueue(); } catch(e) { setError(message(e)); } }}>移除这条损坏记录，保留原片</button></div></div></article>)}</>}
      cameraRecovery={Capacitor.isNativePlatform() ? <><div className="button-row library-recovery-actions"><button disabled={busy} onClick={() => void recoverCamera()}>读取上次相机照片</button>
        {localPhotosEnabled && <button disabled={busy || !!uploading} onClick={() => void recoverGallery()}>恢复相册批次</button>}
        {cameraWaiting && <button disabled={busy} onClick={() => { try { clearUnfinishedCamera(owner); setCameraWaiting(false); } catch(e) { setError(message(e)); } }}>取消未完成的相机操作</button>}</div>
        {cameraFailures.map(({ result, message: reason }) => <article className="draft-card" key={result.id}><div><strong>上次照片暂时无法读取</strong>
          <p role="alert">{reason}。其他可读取的照片已继续恢复；这条引用仍保留。</p><div className="button-row">
            <button disabled={busy} onClick={() => void recoverCamera()}>重试读取</button>
            <button disabled={busy} onClick={() => { try {
              if (result.owner !== owner || result.studentId !== activeStudent.current) throw new Error('相机结果归属已变化');
              removeCameraResult(result); setCameraFailures(list => list.filter(item => item.result.id !== result.id));
            } catch(e) { setError(message(e)); } }}>移除这条相机引用，保留原片</button>
          </div></div></article>)}</> : null}
      recognition={recognition} error={error || cameraRestoreError} notice={notice}
      onSelect={selectStudent} onCapture={(source) => void capture(source)} onRefresh={() => { void refresh(); try { refreshPhotoQueue(); } catch(e) { setError(message(e)); } }}
      onOpenScan={openReview}
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
    ><FamilyLinks admin={auth.capabilities?.admin} /></HomeView>
    {fileInputs}
  </>;
}

function FamilyLinks({ admin = false }: { admin?: boolean }) {
  if (isHostedWeb) return <WebAppInfo admin={admin} />;
  return (
    <div className="family-links">
      <span>{appName} {appVersion} · 家庭试用版</span>
      <UpdateControl />

    </div>
  );
}
function PreparedDraftCard({ record, uploading, disabled, onUpload, onRemove }: {
  record: PhotoDeliveryRecord; uploading: boolean; disabled: boolean; onUpload: () => void; onRemove: () => void;
}) {
  return <article className="draft-card"><img src={previewUrl(record.prepared)} alt="已确认的处理图" />
    <div><strong>处理图 · {new Date(record.confirmedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</strong>
      <small>{(record.prepared.bytes / 1024 / 1024).toFixed(1)} MiB · 待上传</small>
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
