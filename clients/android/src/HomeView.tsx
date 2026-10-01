import { useState, type ReactNode } from 'react';
import { Camera, ChevronRight, FileImage, Home, ImagePlus, Layers, LogOut, Plus, RefreshCw, UserRound } from 'lucide-react';
import { BrandMark } from './Brand';
import { PermissionInfo } from './PermissionInfo';
import { UpdateDot } from './UpdateControl';
import { appName, appVersion } from './release';
import { statusNames, type Scan, type Student } from './types';
import type { Draft } from './drafts';
import { FeatureCatalog } from './FeatureCatalog';
import { FeatureDialog } from './FeatureDialog';

export type HomePage = 'home' | 'library' | 'me';

type Props = {
  username: string; students: Student[]; selected: string; records: Scan[]; localDrafts: Draft[];
  busy: boolean; uploading: string; refreshing: boolean; recognition: boolean; error: string; notice: string;
  page: HomePage; onNavigate: (page: HomePage) => void;
  onSelect: (id: string) => void; onCapture: (source: 'camera' | 'gallery') => void;
  onRefresh: () => void; onOpenScan: (scan: Scan) => void; onLogout: () => void;
  onAddStudent: (name: string, grade: string) => Promise<boolean>;
  renderDraft: (draft: Draft) => ReactNode; children: ReactNode;
};

export function HomeView(props: Props) {
  const { username, students, selected, records, localDrafts, busy, uploading, refreshing, error, notice } = props;
  const tab = props.page;
  const [feature, setFeature] = useState('');
  const [adding, setAdding] = useState(false), [name, setName] = useState(''), [grade, setGrade] = useState('');
  const student = students.find((s) => s.id === selected);
  const pending = localDrafts.filter((d) => d.studentId === selected);
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
        <span className="subject-tag">数学</span>
      </section>}
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <output className="notice">{notice}</output>}

      {tab === 'home' && <div className="home-content">
        <section className="home-capture">
          <div className="home-capture-heading"><span className="eyebrow">错题 · 难题 · 手写过程</span><h1>收下每一次思考</h1></div>
          <div className="home-capture-actions">
            <button type="button" className="capture-primary" disabled={busy || !student} onClick={() => props.onCapture('camera')}>
              <Camera size={26} /><span><strong>拍照收题</strong><small>题目与手写过程</small></span>
            </button>
            <button type="button" className="capture-secondary" disabled={busy || !student} onClick={() => props.onCapture('gallery')}>
              <ImagePlus size={23} /><span><strong>相册选图</strong><small>从已有照片导入</small></span>
            </button>
          </div>
        </section>
        <FeatureCatalog compact onSelect={setFeature} />
        {!student ? <section className="home-empty"><h2>先建一个孩子的学习档案</h2><p>一家多个孩子，资料分别保存。</p><button className="primary" onClick={addStudent}><Plus size={17} />添加第一名学生</button></section>
          : <>
            <section className="home-summary" aria-label="待处理事项">
              <button onClick={() => navigate('library')}><span className="summary-number">{pending.length}</span><span>待上传</span><ChevronRight size={15} /></button>
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
          <div className="library-capture-actions"><button className="primary" disabled={busy} onClick={() => props.onCapture('camera')}><Camera size={18} />拍照收题</button><button disabled={busy} onClick={() => props.onCapture('gallery')}><ImagePlus size={18} />相册选图</button></div>
          {pending.length > 0 && <section className="draft-section"><div className="section-line"><h2>待上传照片 · {pending.length}</h2><span className="hint">仅保存在本机</span></div><div className="draft-grid">{pending.map(props.renderDraft)}</div></section>}
          <section className="records-section"><div className="section-line"><h2>已保存资料 · {records.length}</h2></div>
            {records.length ? <div className="record-grid">{records.map((scan) => scanCard(scan))}</div> : <div className="empty-records"><FileImage size={30} /><p>{refreshing ? '正在读取资料…' : '还没有上传资料。可以拍照或从相册选图。'}</p></div>}
            {!props.recognition && <p className="hint">识别服务暂不可用，仍可手动分题并保存作答过程。</p>}
          </section>
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
        <section className="profile-card profile-storage"><h2>资料与功能</h2><p>确认上传的原图与校对结果保存在家庭服务器，按孩子、日期和科目关联。</p><p className="hint">当前可拍照、选图、识别和校对。文档导入、错因分析和举一反三正在准备中。</p></section>
        {props.children}
      </div>}
    </main>
    <nav className="bottom-nav" aria-label="主要页面">
      <button aria-current={tab === 'home' ? 'page' : undefined} onClick={() => navigate('home')}><Home size={21} /><span>首页</span></button>
      <button aria-current={tab === 'library' ? 'page' : undefined} onClick={() => navigate('library')}><Layers size={21} /><span>题目</span>{pending.length > 0 && <span className="nav-dot" aria-label="有照片待上传" />}</button>
      <button aria-current={tab === 'me' ? 'page' : undefined} onClick={() => navigate('me')}><UserRound size={21} /><span>我的</span><UpdateDot /></button>
    </nav>
    {feature && <FeatureDialog feature={feature} onClose={() => setFeature('')} onContinue={() => {
      setFeature(''); navigate('home');
      if (!student) addStudent();
      else document.querySelector<HTMLButtonElement>('.capture-primary')?.focus();
    }} />}
  </div>;
}
