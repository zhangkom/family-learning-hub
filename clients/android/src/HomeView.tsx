import type { LearningMode } from '../../../lib/learning-session';
import { learningProgress, useLearningHistory } from './learning-history';
import { useState, type ReactNode } from 'react';
import { ChevronRight, Cloud, FileImage, Plus, RefreshCw, UserRound } from 'lucide-react';
import { BottomNavigation, type HomePage } from './BottomNavigation';
import { BrandMark } from './Brand';
import { appName } from './release';
import { statusNames, type Scan, type Student } from './types';
import type { Draft } from './drafts';
import { QuestionLibrary, type LibraryMode, type LibraryContext } from './QuestionLibrary';
import type { StudentOverviewReply } from './types';
import { AccountSettings, type AccountChange } from './AccountSettings';
import type { FamilyApi } from './api';
import { LearningModules } from './LearningModules';
import { CaptureEntries } from './CaptureEntries';
import { needsPhotoReview, needsQuestionReview } from './photo-review-filter';
import { questionCollectionState } from '../../../lib/question-collection';
import { sourcePageLabel } from './source-location';

export type { HomePage } from './BottomNavigation';

type Props = {
  api: FamilyApi; owner: string;
  username: string; students: Student[]; selected: string; records: Scan[]; localDrafts: Draft[];
  busy: boolean; uploading: string; refreshing: boolean; recognition: boolean; error: string; notice: string;
  page: HomePage; onNavigate: (page: HomePage) => void;
  libraryMode: LibraryMode; onLibraryMode: (mode: LibraryMode) => void;
  libraryContext: LibraryContext; onLibraryContext: (context: LibraryContext) => void;
  studentOverview: StudentOverviewReply | null; overviewError: string; onRefreshOverview: () => void;
  onSelect: (id: string) => void; onCapture: (source: 'camera' | 'gallery') => void;
  learningRevision: number; onLearn: (mode: LearningMode, source?: { scanId: string; questionId: string }, sessionId?: string) => void;
  lastViewed?: { scanId: string; questionId?: string };
  onRefresh: () => void; onOpenScan: (scan: Scan, questionId?: string) => void; onLogout: () => void;
  onUpdateScan?: (scan: Scan) => void;
  onAddStudent: (name: string, grade: string) => Promise<boolean>;
  onUpdateAccount: (kind: AccountChange, value: string, currentPassword: string) => Promise<string>;
  renderDraft: (draft: Draft) => ReactNode; children: ReactNode;
  processedPending?: ReactNode; processedCount?: number; onOpenOriginals?: () => void; cameraRecovery?: ReactNode;
  onOpenCloud?: () => void; batchUploads?: ReactNode;
};

export function HomeView(props: Props) {
  const { username, students, selected, records, localDrafts, busy, uploading, refreshing, error, notice } = props;
  const tab = props.page;
  const [accountChange, setAccountChange] = useState<AccountChange | null>(null);
  const [adding, setAdding] = useState(false), [name, setName] = useState(''), [grade, setGrade] = useState('');
  const student = students.find((s) => s.id === selected);
  const pending = localDrafts.filter((d) => d.studentId === selected);
  const pendingCount = pending.length + (props.processedCount || 0);
  const learning = useLearningHistory(props.api, selected, props.learningRevision);
  const continuing = [...learning.rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).find(item => item.job || item.passedCount < item.taskCount || !item.independentRetest || (item.retestDueAt && new Date(item.retestDueAt).getTime() <= Date.now()));
  const previous = records.find(record => record.id === props.lastViewed?.scanId);
  const nextScan = previous || records[0];
  const nextQuestion = previous?.questions.find(question => question.id === props.lastViewed?.questionId);
  function navigate(next: typeof tab) { props.onNavigate(next); window.scrollTo({ top: 0 }); }
  function addStudent() { navigate('me'); setAdding(true); }
  function scanCard(scan: Scan) {
    const incomplete = scan.questions.some(q => questionCollectionState(q).materialPending);
    const status = incomplete ? '待补全' : scan.status === 'ready' && needsPhotoReview(scan) ? '待校对' : statusNames[scan.status] || scan.status;
    return <button className="record-card" key={scan.id} onClick={() => props.onOpenScan(scan, props.libraryContext.photoFilter === 'pending' ? scan.questions.find(needsQuestionReview)?.id : undefined)}>
      <span className="record-icon"><FileImage size={21} /></span>
      <span className="record-content">
        <strong title={scan.originalName}>{scan.sourcePage?.title || scan.originalName}</strong>
        <small>{scan.sourcePage ? sourcePageLabel(scan.sourcePage) : new Date(scan.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })} · {scan.questions.length} 道题</small>
      </span>
      <span className={`status ${incomplete ? 'needs_review' : scan.status}`}>{status}</span>
      <ChevronRight size={16} />
    </button>;
  }
  return <div className="app-shell">
    <header className="topbar learning-topbar">
      <div className="brand"><BrandMark size={36} /><span>{appName}</span></div>
      {tab !== 'me' && <section className="student-switcher" aria-label="当前学习档案">
        <div className="student-select-wrap">
          <span className="student-select-icon"><UserRound size={18} /></span>
          {students.length ? <select aria-label="当前学生" value={selected} onChange={(event) => props.onSelect(event.target.value)}>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}{s.grade ? ` · ${s.grade}` : ''}</option>)}
          </select> : <button type="button" onClick={addStudent}>添加学生档案</button>}
        </div>
      </section>}
    </header>
    <main className={`dashboard ${tab === 'home' ? 'home-dashboard' : ''}`}>
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <output className="notice">{notice}</output>}

      {tab === 'home' && <div className="home-content">
        <CaptureEntries disabled={busy || !!uploading || !student} onRecord={() => props.onCapture('camera')} onBatch={() => props.onCapture('gallery')} />
        {!student ? <section className="home-empty"><h2>先建一个孩子的学习档案</h2><p>一家多个孩子，资料分别保存。</p><button className="primary" onClick={addStudent}><Plus size={17} />添加第一名学生</button></section>
          : continuing ? <section className="learning-continue" aria-label="继续学习"><div><strong>{continuing.mode === 'practice' ? '接着练习' : '继续突破'}</strong><small>{continuing.source.subject} · {learningProgress(continuing)}</small></div><button onClick={() => props.onLearn(continuing.mode, undefined, continuing.id)}>继续学习 <ChevronRight size={16} /></button></section>
          : <section className="learning-continue" aria-label="继续学习">
            <div><strong>{previous ? '接着上次学' : nextScan ? '从最近资料开始' : '从第一道题开始'}</strong><small>{nextScan ? nextQuestion ? `${nextQuestion.subject || '待选科目'} · 第 ${nextQuestion.number || '1'} 题` : `${nextScan.originalName} · ${statusNames[nextScan.status]}` : refreshing ? '正在读取学习资料…' : '拍照或选图，留下自己的学习记录。'}</small></div>
            {nextScan && <button onClick={() => props.onOpenScan(nextScan, nextQuestion?.id)}>继续学习 <ChevronRight size={16} /></button>}
          </section>}
        <nav className="home-resource-links" aria-label="资料管理">
          <button disabled={busy || !student} onClick={() => { props.onLibraryMode('photos'); navigate('library'); }}><FileImage size={17} /><span>原题照片{records.some(needsPhotoReview) ? ' · 待整理' : ''}</span></button>
          {props.onOpenCloud && <button disabled={busy || !!uploading || !student} onClick={props.onOpenCloud}><Cloud size={17} /><span>图片云盘</span></button>}
        </nav>
        {student && <div id="home-pending">          {props.batchUploads}
          {!!props.processedCount && <section className="draft-section"><div className="section-line"><h2>处理图待提交 · {props.processedCount}</h2><span className="hint">尚未发送 · 原片留在本机</span></div><div className="draft-grid">{props.processedPending}</div></section>}
          {pending.length > 0 && <section className="draft-section"><div className="section-line"><h2>待上传照片 · {pending.length}</h2><span className="hint">仅保存在本机</span></div><div className="draft-grid">{pending.map(props.renderDraft)}</div></section>}
</div>}
        <LearningModules onPractice={() => props.onLearn('practice')} onChallenge={() => props.onLearn('challenge')} onReview={() => { props.onLibraryMode('wrong'); navigate('library'); }} onKnowledge={() => { props.onLibraryMode('knowledge'); navigate('library'); }} />
        {student && (props.onOpenOriginals || props.cameraRecovery) && <details className="home-local-tools"><summary>本机照片与恢复</summary><div>{props.onOpenOriginals && <button disabled={busy} onClick={props.onOpenOriginals}>本机原片</button>}{props.cameraRecovery}</div></details>}
      </div>}

      {tab === 'library' && <>
        <div className="section-line library-heading"><div><h1>题目</h1></div><button disabled={refreshing || !student} onClick={props.onRefresh}><RefreshCw size={17} className={refreshing ? 'spin' : ''} />刷新</button></div>
        {student ? <QuestionLibrary key={`${props.owner}|${student.id}`} api={props.api} owner={props.owner} studentId={student.id} learning={learning.rows} onLearn={props.onLearn} records={records} mode={props.libraryMode} onMode={props.onLibraryMode}
          context={props.libraryContext} onContext={props.onLibraryContext} onOpen={props.onOpenScan} onUpdate={props.onUpdateScan} renderScan={scanCard} refreshing={refreshing} /> : <div className="empty"><p>先添加学生档案，题目会按孩子分别整理。</p><button className="primary" onClick={addStudent}>添加学生</button></div>}
      </>}

      {tab === 'me' && <div className="profile-page">
        <section className="profile-card profile-account"><div><span className="eyebrow">家庭账号</span><h1>{username}</h1><p>{students.length} 位学生 · 学习资料分别保存</p></div><div className="profile-account-actions"><button disabled={busy || !!uploading} onClick={() => setAccountChange('username')}>修改用户名</button><button disabled={busy || !!uploading} onClick={() => setAccountChange('password')}>修改密码</button><button disabled={busy || !!uploading} onClick={props.onLogout}>退出登录</button></div></section>
        <section className="student-section profile-students">
          <div className="section-line"><h2>学生档案</h2><button onClick={() => setAdding(!adding)}><Plus size={16} />添加学生</button></div>
          <div className="student-profile-grid">{students.map((s, index) => {
            const stats = props.studentOverview?.students.find(item => item.id === s.id)?.overview;
            return <button key={s.id} className={`student-profile-card ${selected === s.id ? 'active' : ''}`} onClick={() => { props.onSelect(s.id); props.onLibraryMode('wrong'); navigate('library'); }}>
              <div className="student-profile-title"><span className={`avatar tone-${index % 3}`}>{s.name.slice(0, 1)}</span><span><strong>{s.name}</strong><small>{s.grade || '年级未填写'}</small></span>{selected === s.id && <em>当前</em>}</div>
              <div className="student-profile-stats"><span><strong>{stats?.wrongQuestionCount ?? '—'}</strong><small>道错题</small></span><span><strong>{stats?.scanCount ?? '—'}</strong><small>张题目照片</small></span><span><strong>{stats?.needsReviewCount ?? '—'}</strong><small>张待校对</small></span></div>
              {stats?.learningSessionCount !== undefined && <p>练习与突破 {stats.learningSessionCount} 组 · 独立复测通过 {stats.independentRetestCount ?? 0} 组</p>}
              <p>{stats ? `已整理 ${stats.questionCount} 道题 · 云盘保存 ${stats.cloudPhotoCount} 张` : props.overviewError ? '统计暂不可用' : '正在读取学习记录…'}<ChevronRight size={14} /></p>
            </button>;
          })}</div>
          {props.overviewError && <p role="alert" className="hint">{props.overviewError} <button onClick={props.onRefreshOverview}>重新读取</button></p>}
          {!!props.studentOverview?.unassignedScanCount && <p className="hint">另有 {props.studentOverview.unassignedScanCount} 张历史照片尚未明确归属，未计入学生统计。</p>}
          {adding && <form className="add-student" onSubmit={async (event) => {
            event.preventDefault();
            if (await props.onAddStudent(name.trim(), grade.trim())) { setName(''); setGrade(''); setAdding(false); navigate('home'); }
          }}>
            <label>学生昵称<input value={name} maxLength={60} required disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="例如：小宝" /></label>
            <label>年级（选填）<input value={grade} maxLength={80} disabled={busy} onChange={(event) => setGrade(event.target.value)} placeholder="例如：初一" /></label>
            <button className="primary" disabled={busy}>添加</button>
          </form>}
        </section>
        {props.children}

      </div>}
    </main>
    <BottomNavigation page={tab} onNavigate={navigate} pending={pendingCount > 0} />
    {accountChange && <AccountSettings kind={accountChange} username={username} onClose={() => setAccountChange(null)} onSave={props.onUpdateAccount} />}
  </div>;
}
