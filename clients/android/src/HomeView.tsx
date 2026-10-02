import { useState, type ReactNode } from 'react';
import { Camera, ChevronRight, FileImage, ImagePlus, LogOut, Plus, RefreshCw, UserRound } from 'lucide-react';
import { BottomNavigation, type HomePage } from './BottomNavigation';
import { BrandMark } from './Brand';
import { PermissionInfo } from './PermissionInfo';
import { UpdateDot } from './UpdateControl';
import { appName, appVersion } from './release';
import { statusNames, type Scan, type Student } from './types';
import type { Draft } from './drafts';
import { FeatureCatalog } from './FeatureCatalog';
import { FeatureDialog } from './FeatureDialog';
import { AccountSettings, type AccountChange } from './AccountSettings';

export type { HomePage } from './BottomNavigation';

type Props = {
  username: string; students: Student[]; selected: string; records: Scan[]; localDrafts: Draft[];
  busy: boolean; uploading: string; refreshing: boolean; recognition: boolean; error: string; notice: string;
  page: HomePage; onNavigate: (page: HomePage) => void;
  libraryMode: 'photos' | 'wrong'; onLibraryMode: (mode: 'photos' | 'wrong') => void;
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
  const [feature, setFeature] = useState('');
  const [accountChange, setAccountChange] = useState<AccountChange | null>(null);
  const [adding, setAdding] = useState(false), [name, setName] = useState(''), [grade, setGrade] = useState('');
  const student = students.find((s) => s.id === selected);
  const pending = localDrafts.filter((d) => d.studentId === selected);
  const pendingCount = pending.length + (props.processedCount || 0);
  const reviewCount = records.filter((r) => r.status === 'needs_review').length;
  const wrongQuestions = records.flatMap((scan) => scan.questions.filter((q) => q.wrongBook).map((question) => ({ scan, question })))
    .sort((a, b) => (b.question.wrongBook?.savedAt || '').localeCompare(a.question.wrongBook?.savedAt || ''));
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
      <button type="button" className="version-chip" onClick={() => navigate('me')} aria-label="版本与更新">
        v{appVersion} <UpdateDot />
      </button>
    </header>
    <main className={`dashboard ${tab === 'home' ? 'home-dashboard' : ''}`}>
      {tab !== 'me' && <section className="student-switcher" aria-label="当前学习档案">
        <div className="student-select-wrap">
          <span className="student-select-icon"><UserRound size={18} /></span>
          {students.length ? <select aria-label="当前学生" value={selected} onChange={(event) => props.onSelect(event.target.value)}>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}{s.grade ? ` · ${s.grade}` : ''}</option>)}
          </select> : <button type="button" onClick={addStudent}>添加学生档案</button>}
        </div>
        <span className="subject-tag">框题后选科目</span>
      </section>}
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <output className="notice">{notice}</output>}

      {tab === 'home' && <div className="home-content">
        <section className="home-capture">
          <div className="home-capture-heading"><span className="eyebrow">错题 · 难题 · 手写过程</span><h1>收下每一次思考</h1></div>
          <div className="home-capture-actions">
            <button type="button" className="capture-primary" disabled={busy || !!uploading || !student} onClick={() => props.onCapture('camera')}>
              <Camera size={26} /><span><strong>拍照收题</strong><small>连续拍摄 · 最多 100 张</small></span>
            </button>
            <button type="button" className="capture-secondary" disabled={busy || !!uploading || !student} onClick={() => props.onCapture('gallery')}>
              <ImagePlus size={23} /><span><strong>相册选图</strong><small>多选导入 · 最多 100 张</small></span>
            </button>
          </div>
          {props.onOpenCloud && <button className="cloud-drive-entry" disabled={busy || !!uploading || !student} onClick={props.onOpenCloud}>
            <span><strong>批量上传图片</strong><small>图片云盘 · 原图保存 · 最多 100 张</small></span><ChevronRight size={20} /></button>}
        </section>
        <FeatureCatalog compact onSelect={(name) => {
          if (name === '错题本') { props.onLibraryMode('wrong'); navigate('library'); }
          else setFeature(name);
        }} />
        {!student ? <section className="home-empty"><h2>先建一个孩子的学习档案</h2><p>一家多个孩子，资料分别保存。</p><button className="primary" onClick={addStudent}><Plus size={17} />添加第一名学生</button></section>
          : <>
            <section className="home-summary" aria-label="待处理事项">
              <button onClick={() => navigate('library')}><span className="summary-number">{pendingCount}</span><span>待上传</span><ChevronRight size={15} /></button>
              <button onClick={() => navigate('library')}><span className="summary-number">{reviewCount}</span><span>待校对</span><ChevronRight size={15} /></button>
              <button onClick={() => navigate('library')}><span className="summary-number">{records.length}</span><span>已存资料</span><ChevronRight size={15} /></button>
            </section>
            <section className="home-recent">
              <div className="section-line"><h2>最近资料</h2><button className="section-link" onClick={() => navigate('library')}>查看全部 <ChevronRight size={14} /></button></div>
              {records.length ? <div className="home-record-list">{records.slice(0, 1).map((scan) => scanCard(scan, true))}</div>
                : <div className="home-empty-records"><FileImage size={28} /><div><strong>{refreshing ? '正在读取资料…' : '第一张题目，从这里开始'}</strong><p>拍照后在“题目”中确认上传，再校对识别结果。</p></div></div>}
            </section>
          </>}
      </div>}

      {tab === 'library' && <>
        <div className="section-line library-heading"><div><span className="eyebrow">{student?.name || '家庭学习'}</span><h1>题目资料</h1></div>
          <button disabled={refreshing || !student} onClick={props.onRefresh}><RefreshCw size={17} className={refreshing ? 'spin' : ''} />刷新</button>
        </div>
        {student ? <>
          <div className="library-capture-actions"><button className="primary" disabled={busy || !!uploading} onClick={() => props.onCapture('camera')}><Camera size={18} />拍照收题</button><button disabled={busy || !!uploading} onClick={() => props.onCapture('gallery')}><ImagePlus size={18} />相册选图</button>
            {props.onOpenOriginals && <button disabled={busy} onClick={props.onOpenOriginals}>本机原片</button>}</div>
          {props.onOpenCloud && <button className="cloud-drive-entry" disabled={busy || !!uploading} onClick={props.onOpenCloud}><span><strong>批量上传图片</strong><small>进入 {student.name} 的图片云盘</small></span><ChevronRight size={20} /></button>}
          {props.cameraRecovery}
          <nav className="library-modes" aria-label="题目分类">
            <button className={props.libraryMode === 'photos' ? 'selected' : ''} onClick={() => props.onLibraryMode('photos')}>全部照片 · {records.length}</button>
            <button className={props.libraryMode === 'wrong' ? 'selected' : ''} onClick={() => props.onLibraryMode('wrong')}>错题本 · {wrongQuestions.length}</button>
          </nav>
          {props.libraryMode === 'wrong' ? <section className="wrong-book" aria-label="错题本">
            <p className="hint">{student.name}的错题，按收录时间排列。点击一道题可看原图、科目和 AI 分析。</p>
            {wrongQuestions.length ? wrongQuestions.map(({ scan, question }) => <button className="wrong-question-card" key={`${scan.id}/${question.id}`} onClick={() => props.onOpenScan(scan, question.id)}>
              <div><span className="subject-tag">{question.subject || '待选科目'}</span><small>第 {question.number || '—'} 题</small></div>
              <strong>{question.prompt || question.tutoring?.result?.transcribedPrompt || '已框选题目，查看原图'}</strong>
              <span>{question.tutoring?.status === 'needs_review' ? 'AI 分析待核对' : question.tutoring?.status === 'failed' ? '分析未完成 · 可重试' : question.tutoring?.status === 'stale' ? '题目已修改 · 需重新分析' : question.tutoring ? '正在分析' : '已保存 · 可开始分析'}</span>
              <small>{new Date(question.wrongBook!.savedAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}</small>
            </button>) : <div className="empty-records"><FileImage size={30} /><p>还没有收录错题。打开一张照片，框题、选科后就能保存。</p><button onClick={() => props.onLibraryMode('photos')}>去照片里框题</button></div>}
          </section> : <>
          {props.batchUploads}
          {!!props.processedCount && <section className="draft-section"><div className="section-line"><h2>处理图待提交 · {props.processedCount}</h2><span className="hint">尚未发送 · 原片留在本机</span></div><div className="draft-grid">{props.processedPending}</div></section>}
          {pending.length > 0 && <section className="draft-section"><div className="section-line"><h2>待上传照片 · {pending.length}</h2><span className="hint">仅保存在本机</span></div><div className="draft-grid">{pending.map(props.renderDraft)}</div></section>}
          <section className="records-section"><div className="section-line"><h2>已保存资料 · {records.length}</h2></div>
            {records.length ? <div className="record-grid">{records.map((scan) => scanCard(scan))}</div> : <div className="empty-records"><FileImage size={30} /><p>{refreshing ? '正在读取资料…' : '还没有上传资料。可以拍照或从相册选图。'}</p></div>}
            {!props.recognition && <p className="hint">识别服务暂不可用，仍可手动分题并保存作答过程。</p>}
          </section>
          </>}
        </> : <div className="empty"><p>先添加一个学生，再开始收题。</p><button className="primary" onClick={addStudent}>添加学生</button></div>}
      </>}

      {tab === 'me' && <div className="profile-page">
        <section className="profile-card"><div><span className="eyebrow">家庭账号</span><h1>{username}</h1><p>{students.length} 位学生 · 学习资料分别保存</p></div><button disabled={busy || !!uploading} onClick={props.onLogout}><LogOut size={17} />退出登录</button></section>
        <section className="student-section profile-students">
          <div className="section-line"><h2>学生档案</h2><button onClick={() => setAdding(!adding)}><Plus size={16} />添加学生</button></div>
          <div className="student-tabs">{students.map((s, index) => <button key={s.id} className={`student-tab ${selected === s.id ? 'active' : ''}`} onClick={() => { props.onSelect(s.id); navigate('home'); }}>
            <span className={`avatar tone-${index % 3}`}>{s.name.slice(0, 1)}</span><span><strong>{s.name}</strong><small>{s.grade || '学习档案'}</small></span>
          </button>)}</div>
          {adding && <form className="add-student" onSubmit={async (event) => {
            event.preventDefault();
            if (await props.onAddStudent(name.trim(), grade.trim())) { setName(''); setGrade(''); setAdding(false); navigate('home'); }
          }}>
            <label>学生昵称<input value={name} maxLength={60} required disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="例如：小宝" /></label>
            <label>年级（选填）<input value={grade} maxLength={80} disabled={busy} onChange={(event) => setGrade(event.target.value)} placeholder="例如：初一" /></label>
            <button className="primary" disabled={busy}>添加</button>
          </form>}
        </section>
        <PermissionInfo />
        <section className="profile-card"><h2>账号设置</h2><div className="button-row"><button disabled={busy || !!uploading} onClick={() => setAccountChange('username')}>修改用户名</button><button disabled={busy || !!uploading} onClick={() => setAccountChange('password')}>修改密码</button></div></section>
        <section className="profile-card profile-storage"><h2>资料与功能</h2><p>拍题支持每批 100 张，处理后上传确认的图片，原片留在手机。“图片云盘”可将选中的手机原图完整复制到家庭服务器，按当前孩子保存，不自动识别。</p><p className="hint">卸载应用或清除应用数据会删除本机原片和待提交照片；已上传成功的云盘照片仍保留在服务器。框题选科后可存错题本并请求 AI 讲解，分析结果需核对。</p></section>
        {props.children}
      </div>}
    </main>
    <BottomNavigation page={tab} onNavigate={navigate} pending={pendingCount > 0} />
    {accountChange && <AccountSettings kind={accountChange} username={username} onClose={() => setAccountChange(null)} onSave={props.onUpdateAccount} />}
    {feature && <FeatureDialog feature={feature} onClose={() => setFeature('')} onContinue={() => {
      setFeature(''); navigate('home');
      if (!student) addStudent();
      else document.querySelector<HTMLButtonElement>('.capture-primary')?.focus();
    }} />}
  </div>;
}
