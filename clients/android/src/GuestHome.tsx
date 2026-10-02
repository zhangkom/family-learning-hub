import {
  Camera,
  Cloud,
  ImagePlus,
  Layers,
  UserRound,
} from 'lucide-react';
import { useEffect } from 'react';
import { LearningModules } from './LearningModules';
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
        <LearningModules onReview={() => onAuth('login', '错题本')} onKnowledge={() => onAuth('login', '知识点归纳')} />
        <section className="learning-continue"><div><strong>从一道题，开始积累</strong><small>登录后按孩子保存与整理。</small></div><button onClick={() => onAuth('login')}>开始学习</button></section>
        <nav className="learning-tools" aria-label="添加学习资料">
          <button onClick={() => onAuth('login', '拍照收题')}><Camera size={22} /><span>拍照收题</span></button>
          <button onClick={() => onAuth('login', '相册选图')}><ImagePlus size={22} /><span>相册选图</span></button>
          <button onClick={() => onAuth('login', '图片云盘')}><Cloud size={22} /><span>图片云盘</span></button>
        </nav>
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
