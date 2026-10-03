import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./hosted-web', () => ({ isHostedWeb: false }));
import { subscribeWebLocation, writeWebLocation } from './web-navigation';

afterEach(() => vi.unstubAllGlobals());
it('does not change history or register web listeners in Android builds', () => {
  const pushState = vi.fn(), addEventListener = vi.fn();
  vi.stubGlobal('window', { history: { pushState }, addEventListener });
  writeWebLocation({ page: 'library' });
  subscribeWebLocation(vi.fn())();
  expect(pushState).not.toHaveBeenCalled(); expect(addEventListener).not.toHaveBeenCalled();
});
