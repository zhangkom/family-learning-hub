import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./hosted-web', () => ({ isHostedWeb: true }));
import { parseWebHash, readWebLocation, subscribeWebLocation, syncLearningWebLocation, webRouteHash, writeWebLocation, type HostedWebRoute } from './web-navigation';

afterEach(() => vi.unstubAllGlobals());

describe('hosted browser navigation', () => {
  it('restores each top-level page and question view', () => {
    for (const hash of ['#/home', '#/me', '#/questions', '#/questions?view=knowledge', '#/questions?view=photos']) expect(webRouteHash(parseWebHash(hash))).toBe(hash);
  });
  it('preserves the learning session, source and originating question view', () => {
    const route: HostedWebRoute = { page: 'library', libraryMode: 'knowledge', learning: { mode: 'challenge', sessionId: 'session-1', source: { scanId: 'scan_2', questionId: 'q-13' } } };
    expect(parseWebHash(webRouteHash(route))).toEqual(route);
    expect(parseWebHash('#/learn/practice')).toEqual({ page: 'home', learning: { mode: 'practice' } });
  });
  it('does not promote unknown routes, incomplete sources or unsafe identifiers', () => {
    expect(parseWebHash('#/admin?token=secret')).toEqual({ page: 'home' });
    expect(parseWebHash('#/questions?view=unknown')).toEqual({ page: 'library', libraryMode: 'wrong' });
    expect(parseWebHash('#/learn/practice?scan=one&session=https://other&from=me')).toEqual({ page: 'me', learning: { mode: 'practice' } });
    expect(parseWebHash('#/learn/practice?scan=one&question=%3Cscript%3E')).toEqual({ page: 'home', learning: { mode: 'practice' } });
  });
  it('restores cloud, source review and capture overlays without losing the originating view', () => {
    const routes: HostedWebRoute[] = [
      { page: 'home', overlay: { kind: 'cloud' } },
      { page: 'library', libraryMode: 'photos', overlay: { kind: 'review', scanId: 'scan-1', questionId: 'q-1' } },
      { page: 'me', overlay: { kind: 'capture' } },
    ];
    for (const route of routes) expect(parseWebHash(webRouteHash(route))).toEqual(route);
    expect(parseWebHash('#/question/../../other?from=library')).toEqual({ page: 'library', libraryMode: 'wrong' });
  });
  it('keeps the learning return context separate from the reviewed source question', () => {
    const route: HostedWebRoute = { page: 'library', libraryMode: 'knowledge', learning: { mode: 'challenge', sessionId: 'session-a', source: { scanId: 'scan-learning', questionId: 'q-learning' } }, overlay: { kind: 'review', scanId: 'scan-review', questionId: 'q-review' } };
    const hash = webRouteHash(route);
    expect(hash).toContain('sourceQuestion=q-learning'); expect(hash).toContain('question=q-review');
    expect(parseWebHash(hash)).toEqual(route);
    expect(parseWebHash('#/question/scan-review?learn=other&session=a&question=q-review')).toEqual({ page: 'home', overlay: { kind: 'review', scanId: 'scan-review', questionId: 'q-review' } });
    expect(parseWebHash('#/question/scan-review?learn=practice&session=https://bad&scan=good&sourceQuestion=%3Cscript%3E&question=q-review')).toEqual({ page: 'home', learning: { mode: 'practice' }, overlay: { kind: 'review', scanId: 'scan-review', questionId: 'q-review' } });
  });
  it('is safe without a browser during module and server rendering', () => {
    vi.stubGlobal('window', undefined);
    expect(readWebLocation()).toEqual({ page: 'home' });
    expect(() => writeWebLocation({ page: 'me' })).not.toThrow();
    expect(() => subscribeWebLocation(vi.fn())()).not.toThrow();
    expect(() => syncLearningWebLocation({ mode: 'practice' })).not.toThrow();
  });
  it('bookmarks new and selected sessions without remounting the active learning view', () => {
    const state = { framework: 'preserved' }, location = { hash: '#/learn/practice?from=library&view=knowledge' };
    const replaceState = vi.fn((_state: unknown, _title: string, hash: string) => { location.hash = hash; });
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { location, history: { state, replaceState }, dispatchEvent });
    const source = { scanId: 'scan-a', questionId: 'q1' };
    syncLearningWebLocation({ mode: 'practice', source, sessionId: 'new-session' });
    expect(readWebLocation()).toEqual({ page: 'library', libraryMode: 'knowledge', learning: { mode: 'practice', source, sessionId: 'new-session' } });
    expect(replaceState).toHaveBeenLastCalledWith(state, '', location.hash);
    expect(dispatchEvent).not.toHaveBeenCalled();
    syncLearningWebLocation({ mode: 'practice', source, sessionId: 'new-session' });
    expect(replaceState).toHaveBeenCalledTimes(1);
    syncLearningWebLocation({ mode: 'practice', source });
    expect(readWebLocation().learning?.sessionId).toBeUndefined();
    syncLearningWebLocation({ mode: 'practice' });
    expect(readWebLocation().learning?.source).toBeUndefined();
    syncLearningWebLocation({ mode: 'practice', sessionId: 'from-history' });
    expect(readWebLocation().learning).toEqual({ mode: 'practice', sessionId: 'from-history' });
    syncLearningWebLocation({ mode: 'practice' });
    expect(readWebLocation().learning).toEqual({ mode: 'practice' });
    for (const hash of ['#/home', '#/learn/challenge?session=other', '#/question/scan-a?learn=practice&session=new-session']) {
      location.hash = hash; replaceState.mockClear();
      syncLearningWebLocation({ mode: 'practice', source, sessionId: 'late-result' });
      expect(replaceState).not.toHaveBeenCalled();
    }
  });
  it('keeps host history state, notifies on push/replace and listens for browser traversal', () => {
    const target = new EventTarget(), state = { framework: 'keep-this' }, location = { hash: '#/home' };
    const set = vi.fn((_state: unknown, _title: string, hash: string) => { location.hash = hash; });
    const fake = { location, history: { state, pushState: set, replaceState: set }, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target) };
    vi.stubGlobal('window', fake);
    const listener = vi.fn(), stop = subscribeWebLocation(listener);
    writeWebLocation({ page: 'library', libraryMode: 'photos' });
    expect(set).toHaveBeenCalledWith(state, '', '#/questions?view=photos');
    expect(listener).toHaveBeenLastCalledWith({ page: 'library', libraryMode: 'photos' });
    writeWebLocation({ page: 'library', libraryMode: 'photos' }); expect(set).toHaveBeenCalledTimes(1);
    writeWebLocation({ page: 'me' }, { replace: true }); expect(set).toHaveBeenCalledTimes(2);
    location.hash = '#/home'; target.dispatchEvent(new Event('popstate')); expect(listener).toHaveBeenLastCalledWith({ page: 'home' });
    location.hash = '#/questions'; target.dispatchEvent(new Event('hashchange')); expect(listener).toHaveBeenLastCalledWith({ page: 'library', libraryMode: 'wrong' });
    stop(); listener.mockClear(); target.dispatchEvent(new Event('hashchange')); expect(listener).not.toHaveBeenCalled();
  });
});
