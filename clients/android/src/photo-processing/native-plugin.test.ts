import { expect, it, vi } from 'vitest';
const register = vi.hoisted(() => vi.fn(() => ({})));
vi.mock('@capacitor/core', () => ({ registerPlugin: register }));

it('loads photo, batch, and download APIs with one shared native registration', async () => {
  await import('./index');
  await import('./batch');
  await import('./cloud-download');
  const { photoPlugin } = await import('./native-plugin');
  expect(register).toHaveBeenCalledTimes(1);
  expect(register).toHaveBeenCalledWith('PhotoProcessing');
  expect(photoPlugin<object>()).toBe(photoPlugin<object>());
});
