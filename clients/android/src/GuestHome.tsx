import {
  Camera,
  ChevronRight,
  ImagePlus,
  Layers,
  UserRound,
} from 'lucide-react';
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { BottomNavigation, type HomePage } from './BottomNavigation';
import { PermissionInfo } from './PermissionInfo';
import { BrandMark } from './Brand';
import { FeatureCatalog } from './FeatureCatalog';
import { appName, appVersion } from './release';
import { UpdateControl, UpdateDot } from './UpdateControl';

export function GuestHome({
  onAuth,
  page, onNavigate,
}: {
  page: HomePage; onNavigate: (page: HomePage) => void;
  onAuth: (mode: 'login' | 'register', feature?: string) => void;
}) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || page === 'home') return;
    const listener = NativeApp.addListener('backButton', () => onNavigate('home'));
    return () => { void listener.then((handle) => handle.remove()); };
  }, [page, onNavigate]);
  return (
    <div className="app-shell guest-shell">
      <header className="topbar guest-topbar">
        <div className="guest-brand-group">
          <div className="brand">
            <BrandMark size={36} />
            <span>{appName}</span>
          </div>
          <details className="guest-update-panel">
            <summary aria-label="版本与更新">
              v{appVersion}
              <UpdateDot />
            </summary>
            <div className="guest-update-content">
              <UpdateControl />
            </div>
          </details>
        </div>
        <nav className="guest-auth-actions" aria-label="账户">
          <button
            type="button"
            className="guest-register"
            onClick={() => onAuth('register')}
          >
            注册
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => onAuth('login')}
          >
            登录
          </button>
        </nav>
      </header>
      <main className={`dashboard guest-dashboard ${page === 'home' ? 'home-dashboard' : 'guest-secondary'}`}>
        {page === 'home' && <>
        <section className="home-capture guest-capture">
          <div className="home-capture-heading">
            <span className="eyebrow">错题 · 难题 · 手写过程</span>
            <h1>从一道题，开始学会</h1>
            <p>拍下题目和作答，留下每一步思考。</p>
          </div>
          <div className="home-capture-actions">
            <button
              type="button"
              className="capture-primary"
              onClick={() => onAuth('login', '拍照收题')}
            >
              <Camera size={26} />
              <span>
                <strong>拍照收题</strong>
                <small>题目与手写过程</small>
              </span>
            </button>
            <button
              type="button"
              className="capture-secondary"
              onClick={() => onAuth('login', '相册选图')}
            >
              <ImagePlus size={23} />
              <span>
                <strong>相册选图</strong>
                <small>从已有照片导入</small>
              </span>
            </button>
          </div>
        </section>
        <FeatureCatalog onSelect={(feature) => onAuth('login', feature)} />
        <button
          type="button"
          className="guest-account-hint"
          onClick={() => onAuth('register')}
        >
          <span className="guest-account-icon">
            <UserRound size={19} />
          </span>
          <span>
            <strong>建好账号，题目随时找回</strong>
            <small>每个孩子都有自己的学习档案</small>
          </span>
          <ChevronRight size={16} />
        </button>
        </>}
        {page === 'library' && <>
          <div className="section-line library-heading"><div><span className="eyebrow">每一步思考，都值得留下</span><h1>题目资料</h1></div></div>
          <section className="guest-intro-card">
            <span className="guest-intro-icon"><Layers size={32} /></span>
            <h2>题目与作答，随时找回</h2>
            <p>拍照或从相册选图，分开一张照片里的题目，校对题干和手写过程。</p>
            <div className="guest-benefits"><span>按孩子分别保存</span><span>保留原图与作答</span><span>按日期查找资料</span></div>
            <div className="button-row"><button className="primary" onClick={() => onAuth('login', '题目资料')}>登录查看题目</button><button onClick={() => onAuth('register', '题目资料')}>注册</button></div>
          </section>
          <p className="hint guest-private-hint">登录后显示你家的资料。还没账号，也可以先浏览首页的功能。</p>
        </>}
        {page === 'me' && <div className="profile-page">
          <section className="profile-card guest-profile"><span className="guest-intro-icon"><UserRound size={30} /></span><h1>一家人，各自进步</h1><p>一个家庭账号，管理多个孩子的学习档案。</p><div className="button-row"><button className="primary" onClick={() => onAuth('login')}>登录</button><button onClick={() => onAuth('register')}>注册</button></div></section>
          <section className="profile-card"><h2>学生档案</h2><p>登录后添加、切换学生，题目与作答分别保存。</p></section>
          <PermissionInfo />
          <section className="profile-card"><h2>关于{appName}</h2><p>当前版本 {appVersion}</p><p className="hint">可拍照、选图、识别与校对。分步辅导、举一反三和学习报告正在准备中。</p></section>
        </div>}
      </main>
      <BottomNavigation page={page} onNavigate={onNavigate} />
    </div>
  );
}
