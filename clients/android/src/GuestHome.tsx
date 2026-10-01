import {
  Camera,
  ChevronRight,
  Home,
  ImagePlus,
  Layers,
  UserRound,
} from 'lucide-react';
import { BrandMark } from './Brand';
import { FeatureCatalog } from './FeatureCatalog';
import { appName, appVersion } from './release';
import { UpdateControl, UpdateDot } from './UpdateControl';

export function GuestHome({
  onAuth,
}: {
  onAuth: (mode: 'login' | 'register', feature?: string) => void;
}) {
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
      <main className="dashboard home-dashboard guest-dashboard">
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
      </main>
      <nav className="bottom-nav" aria-label="主要页面">
        <button
          type="button"
          aria-current="page"
          onClick={() => window.scrollTo({ top: 0 })}
        >
          <Home size={21} />
          <span>首页</span>
        </button>
        <button type="button" onClick={() => onAuth('login', '题目资料')}>
          <Layers size={21} />
          <span>题目</span>
        </button>
        <button type="button" onClick={() => onAuth('login', '我的')}>
          <UserRound size={21} />
          <span>我的</span>
        </button>
      </nav>
    </div>
  );
}
