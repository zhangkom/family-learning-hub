import { useCallback, useEffect, useState } from 'react';
import type { HomePage } from './BottomNavigation';
import type { LibraryMode } from './QuestionLibrary';
import type { LearningView } from './LearningHub';
import { isHostedWeb } from './hosted-web';

export type HostedWebRoute = { page: HomePage; libraryMode?: LibraryMode; learning?: LearningView;
  overlay?: { kind: 'cloud' } | { kind: 'review'; scanId: string; questionId?: string } | { kind: 'capture' };
};
const routeEvent = 'family-learning:web-route';
const modes = new Set<LibraryMode>(['wrong', 'knowledge', 'photos']);
const id = (value: string | null) => value && value.length <= 160 && /^[a-zA-Z0-9_-]+$/.test(value) ? value : undefined;

/** Routes contain navigation identifiers only, never credentials or question content. */
export function parseWebHash(hash: string): HostedWebRoute {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const view = params.get('view') as LibraryMode;
  const libraryMode = modes.has(view) ? view : 'wrong';
  const page: HomePage = params.get('from') === 'library' ? 'library' : params.get('from') === 'me' ? 'me' : 'home';
  const origin = { page, ...(page === 'library' ? { libraryMode } : {}) };
  if (path === '/cloud' || path === '/capture') return { ...origin, overlay: { kind: path === '/cloud' ? 'cloud' : 'capture' } };
  if (path.startsWith('/question/')) {
    const scanId = id(path.slice('/question/'.length)), questionId = id(params.get('question'));
    return scanId ? { ...origin, overlay: { kind: 'review', scanId, ...(questionId ? { questionId } : {}) } } : origin;
  }
  if (path === '/questions') return { page: 'library', libraryMode };
  if (path === '/me') return { page: 'me' };
  if (path === '/learn/practice' || path === '/learn/challenge') {
    const scanId = id(params.get('scan')), questionId = id(params.get('question')), sessionId = id(params.get('session'));
    return { ...origin, learning: {
      mode: path.endsWith('/practice') ? 'practice' : 'challenge',
      ...(sessionId ? { sessionId } : {}), ...(scanId && questionId ? { source: { scanId, questionId } } : {}),
    } };
  }
  return { page: 'home' };
}

export function webRouteHash(route: HostedWebRoute): string {
  const params = new URLSearchParams();
  if (route.learning) {
    const { source, sessionId } = route.learning;
    if (sessionId && id(sessionId)) params.set('session', sessionId);
    if (source && id(source.scanId) && id(source.questionId)) { params.set('scan', source.scanId); params.set('question', source.questionId); }
  }
  if ((route.learning || route.overlay) && route.page !== 'home') params.set('from', route.page);
  if (route.overlay?.kind === 'review' && route.overlay.questionId && id(route.overlay.questionId)) params.set('question', route.overlay.questionId);
  if (route.page === 'library' && route.libraryMode && route.libraryMode !== 'wrong' && modes.has(route.libraryMode)) params.set('view', route.libraryMode);
  const path = route.overlay ? route.overlay.kind === 'review' ? id(route.overlay.scanId) ? `/question/${route.overlay.scanId}` : '/home' : `/${route.overlay.kind}` : route.learning ? `/learn/${route.learning.mode}` : route.page === 'library' ? '/questions' : `/${route.page}`;
  return `#${path}${params.size ? `?${params}` : ''}`;
}

export function readWebLocation(): HostedWebRoute {
  return typeof window === 'undefined' ? { page: 'home' } : parseWebHash(window.location.hash);
}

export function writeWebLocation(route: HostedWebRoute, options: { replace?: boolean } = {}) {
  if (!isHostedWeb || typeof window === 'undefined') return;
  const hash = webRouteHash(route);
  if (window.location.hash === hash) return;
  window.history[options.replace ? 'replaceState' : 'pushState'](window.history.state, '', hash);
  window.dispatchEvent(new Event(routeEvent));
}

export function subscribeWebLocation(listener: (route: HostedWebRoute) => void): () => void {
  if (!isHostedWeb || typeof window === 'undefined') return () => {};
  const changed = () => listener(readWebLocation());
  window.addEventListener('hashchange', changed); window.addEventListener('popstate', changed); window.addEventListener(routeEvent, changed);
  return () => { window.removeEventListener('hashchange', changed); window.removeEventListener('popstate', changed); window.removeEventListener(routeEvent, changed); };
}

/** App owns authorization and loading the referenced student/session; this hook only follows history. */
export function useHostedWebNavigation() {
  const [route, setRoute] = useState<HostedWebRoute>(() => isHostedWeb ? readWebLocation() : { page: 'home' });
  useEffect(() => subscribeWebLocation(next => setRoute(previous => webRouteHash(previous) === webRouteHash(next) ? previous : next)), []);
  const navigate = useCallback((next: HostedWebRoute, options?: { replace?: boolean }) => writeWebLocation(next, options), []);
  return { route, navigate };
}
