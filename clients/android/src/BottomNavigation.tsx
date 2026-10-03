import { Home, Layers, UserRound } from 'lucide-react';
import { UpdateDot } from './UpdateControl';
import { isHostedWeb } from './hosted-web';
import { webRouteHash } from './web-navigation';

export type HomePage = 'home' | 'library' | 'me';
export const pageNames = { home: '首页', library: '题目', me: '我的' } as const;

export function WebSkipLink() {
  if (!isHostedWeb) return null;
  return <button type="button" className="web-skip-link" onClick={() => {
    const main = document.getElementById('learning-main-content');
    main?.focus({ preventScroll: true }); main?.scrollIntoView({ block: 'start' });
  }}>跳到主要内容</button>;
}

export function BottomNavigation({ page, onNavigate, pending = false }: {
  page: HomePage; onNavigate: (page: HomePage) => void; pending?: boolean;
}) {
  return <nav className="bottom-nav" aria-label="主要页面">
    {([['home', Home], ['library', Layers], ['me', UserRound]] as const).map(([key, Icon]) => isHostedWeb ?
      <a className="web-nav-link" key={key} href={webRouteHash({ page: key })} aria-current={page === key ? 'page' : undefined}
        onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return; event.preventDefault(); onNavigate(key); window.scrollTo({ top: 0 }); }}>
        <Icon size={21} /><span>{pageNames[key]}</span>
        {key === 'home' && pending && <span className="nav-dot" aria-label="有照片待上传" />}
      </a> : <button type="button" key={key} aria-current={page === key ? 'page' : undefined}
        onClick={() => { onNavigate(key); window.scrollTo({ top: 0 }); }}>
        <Icon size={21} /><span>{pageNames[key]}</span>
        {key === 'home' && pending && <span className="nav-dot" aria-label="有照片待上传" />}
        {key === 'me' && <UpdateDot />}
      </button>)}
  </nav>;
}
