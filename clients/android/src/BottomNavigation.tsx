import { Home, Layers, UserRound } from 'lucide-react';
import { UpdateDot } from './UpdateControl';

export type HomePage = 'home' | 'library' | 'me';
export const pageNames = { home: '首页', library: '题目', me: '我的' } as const;

export function BottomNavigation({ page, onNavigate, pending = false }: {
  page: HomePage; onNavigate: (page: HomePage) => void; pending?: boolean;
}) {
  return <nav className="bottom-nav" aria-label="主要页面">
    {([['home', Home], ['library', Layers], ['me', UserRound]] as const).map(([key, Icon]) =>
      <button type="button" key={key} aria-current={page === key ? 'page' : undefined}
        onClick={() => { onNavigate(key); window.scrollTo({ top: 0 }); }}>
        <Icon size={21} /><span>{pageNames[key]}</span>
        {key === 'library' && pending && <span className="nav-dot" aria-label="有照片待上传" />}
        {key === 'me' && <UpdateDot />}
      </button>)}
  </nav>;
}
