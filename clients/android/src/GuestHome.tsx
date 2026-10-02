import {
  Camera,
  ImagePlus,
  Layers,
  UserRound,
} from 'lucide-react';
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { BottomNavigation, type HomePage } from './BottomNavigation';
import { BrandMark } from './Brand';
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
        {page === 'home' && <nav className="guest-auth-actions" aria-label="账户">
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
        </nav>}
      </header>
      <main className={`dashboard guest-dashboard ${page === 'home' ? 'home-dashboard' : 'guest-secondary'}`}>
        {page === 'home' && <>
        <section className="home-capture guest-capture">
          <div className="home-capture-heading">
            <h1>添加题目</h1>
            <p>拍照或选图，登录后按孩子保存。</p>
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
        </>}
        {page === 'library' && <>
          <div className="section-line library-heading"><div><h1>题目</h1></div></div>
          <section className="guest-intro-card">
            <span className="guest-intro-icon"><Layers size={32} /></span>
            <h2>按科目整理与复习</h2>
            <p>登录后查看已有错题、知识点和原题照片。</p>
            <div className="guest-benefits"><span>各科错题</span><span>知识点归纳</span><span>原题照片</span></div>
            <div className="button-row"><button className="primary" onClick={() => onAuth('login', '题目资料')}>登录查看题目</button><button onClick={() => onAuth('register', '题目资料')}>注册</button></div>
          </section>
        </>}
        {page === 'me' && <div className="profile-page">
          <section className="profile-card guest-profile"><span className="guest-intro-icon"><UserRound size={30} /></span><h1>一家人，各自进步</h1><p>一个家庭账号，管理多个孩子的学习档案。</p><div className="button-row"><button className="primary" onClick={() => onAuth('login')}>登录</button><button onClick={() => onAuth('register')}>注册</button></div></section>
          <section className="profile-card"><h2>关于{appName}</h2><p>当前版本 {appVersion}</p><UpdateControl /></section>
        </div>}
      </main>
      <BottomNavigation page={page} onNavigate={onNavigate} />
    </div>
  );
}
