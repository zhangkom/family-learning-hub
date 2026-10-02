import { useState, type ReactNode } from 'react';
import { Camera, ChevronRight, FileImage, ImagePlus, Plus, RefreshCw, UserRound } from 'lucide-react';
import { BottomNavigation, type HomePage } from './BottomNavigation';
import { BrandMark } from './Brand';
import { appName } from './release';
import { statusNames, type Scan, type Student } from './types';
import type { Draft } from './drafts';
import { QuestionLibrary, type LibraryMode } from './QuestionLibrary';
import type { StudentOverviewReply } from './types';
import { AccountSettings, type AccountChange } from './AccountSettings';

export type { HomePage } from './BottomNavigation';

type Props = {
  username: string; students: Student[]; selected: string; records: Scan[]; localDrafts: Draft[];
  busy: boolean; uploading: string; refreshing: boolean; recognition: boolean; error: string; notice: string;
  page: HomePage; onNavigate: (page: HomePage) => void;
  libraryMode: LibraryMode; onLibraryMode: (mode: LibraryMode) => void;
  studentOverview: StudentOverviewReply | null; overviewError: string; onRefreshOverview: () => void;
  onSelect: (id: string) => void; onCapture: (source: 'camera' | 'gallery') => void;
  onRefresh: () => void; onOpenScan: (scan: Scan, questionId?: string) => void; onLogout: () => void;
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
  const reviewCount = records.filter((r) => r.status === 'needs_review').length;
  function navigate(next: typeof tab) { props.onNavigate(next); window.scrollTo({ top: 0 }); }
  function addStudent() { navigate('me'); setAdding(true); }
  function scanCard(scan: Scan, compact = false) {
    return <button className={`record-card ${compact ? 'home-record-card' : ''}`} key={scan.id} onClick={() => props.onOpenScan(scan)}>
      <span className="record-icon"><FileImage size={21} /></span>
      <span className="record-content">
        <strong>{scan.originalName}</strong>
        <small>{new Date(scan.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })} · {scan.questions.length} 道题</small>
      </span>
      <span className={`status ${scan.status}`}>{statusNames[scan.status] || scan.status}</span>
      <ChevronRight size={16} />
    </button>;
  }
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><BrandMark size={36} /><span>{appName}</span></div>
    </header>
    <main className={`dashboard ${tab === 'home' ? 'home-dashboard' : ''}`}>
      {tab !== 'me' && <section className="student-switcher" aria-label="当前学习档案">
        <div className="student-select-wrap">
          <span className="student-select-icon"><UserRound size={18} /></span>
          {students.length ? <select aria-label="当前学生" value={selected} onChange={(event) => props.onSelect(event.target.value)}>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}{s.grade ? ` · ${s.grade}` : ''}</option>)}
          </select> : <button type="button" onClick={addStudent}>添加学生档案</button>}
        </div>
      </section>}
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <output className="notice">{notice}</output>}

      {tab === 'home' && <div className="home-content">
        <section className="home-capture">
          <div className="home-capture-heading"><h1>添加题目</h1></div>
          <div className="home-capture-actions">
            <button type="button" className="capture-primary" disabled={busy || !!uploading || !student} onClick={() => props.onCapture('camera')}>
              <Camera size={26} /><span><strong>拍照收题</strong><small>连续拍摄 · 随时添加</small></span>
            </button>
            <button type="button" className="capture-secondary" disabled={busy || !!uploading || !student} onClick={() => props.onCapture('gallery')}>
              <ImagePlus size={23} /><span><strong>相册选图</strong><small>多选导入 · 随时添加</small></span>
            </button>
          </div>
          {props.onOpenCloud && <button className="cloud-drive-entry" disabled={busy || !!uploading || !student} onClick={props.onOpenCloud}>
            <span><strong>批量上传图片</strong><small>图片云盘 · 保留原文件名</small></span><ChevronRight size={20} /></button>}
        </section>
        {student && (props.onOpenOriginals || props.cameraRecovery) && <details className="home-local-tools"><summary>本机照片与恢复</summary><div>{props.onOpenOriginals && <button disabled={busy} onClick={props.onOpenOriginals}>本机原片</button>}{props.cameraRecovery}</div></details>}
        {student && <div id="home-pending">          {props.batchUploads}
          {!!props.processedCount && <section className="draft-section"><div className="section-line"><h2>处理图待提交 · {props.processedCount}</h2><span className="hint">尚未发送 · 原片留在本机</span></div><div className="draft-grid">{props.processedPending}</div></section>}
          {pending.length > 0 && <section className="draft-section"><div className="section-line"><h2>待上传照片 · {pending.length}</h2><span className="hint">仅保存在本机</span></div><div className="draft-grid">{pending.map(props.renderDraft)}</div></section>}
</div>}
        {!student ? <section className="home-empty"><h2>先建一个孩子的学习档案</h2><p>一家多个孩子，资料分别保存。</p><button className="primary" onClick={addStudent}><Plus size={17} />添加第一名学生</button></section>
          : <>
            <section className="home-summary" aria-label="待处理事项">
              <button onClick={() => document.getElementById('home-pending')?.scrollIntoView({ behavior: 'smooth' })}><span className="summary-number">{pendingCount}</span><span>待上传</span><ChevronRight size={15} /></button>
              <button onClick={() => { props.onLibraryMode('photos'); navigate('library'); }}><span className="summary-number">{reviewCount}</span><span>待校对</span><ChevronRight size={15} /></button>
              <button onClick={() => { props.onLibraryMode('photos'); navigate('library'); }}><span className="summary-number">{records.length}</span><span>已存资料</span><ChevronRight size={15} /></button>
            </section>
            <section className="home-recent">
              <div className="section-line"><h2>最近资料</h2><button className="section-link" onClick={() => { props.onLibraryMode('photos'); navigate('library'); }}>查看全部 <ChevronRight size={14} /></button></div>
              {records.length ? <div className="home-record-list">{records.slice(0, 1).map((scan) => scanCard(scan, true))}</div>
                : <div className="home-empty-records"><FileImage size={28} /><div><strong>{refreshing ? '正在读取资料…' : '第一张题目，从这里开始'}</strong><p>拍照或选图后在首页确认上传，再到“题目”校对和复习。</p></div></div>}
            </section>
          </>}
      </div>}

      {tab === 'library' && <>
        <div className="section-line library-heading"><div><h1>题目</h1></div><button disabled={refreshing || !student} onClick={props.onRefresh}><RefreshCw size={17} className={refreshing ? 'spin' : ''} />刷新</button></div>
        {student ? <QuestionLibrary key={student.id} records={records} mode={props.libraryMode} onMode={props.onLibraryMode} onOpen={props.onOpenScan} renderScan={scanCard} refreshing={refreshing} /> : <div className="empty"><p>先添加学生档案，题目会按孩子分别整理。</p><button className="primary" onClick={addStudent}>添加学生</button></div>}
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
