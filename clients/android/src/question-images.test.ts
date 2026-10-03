import { describe, expect, it, vi } from 'vitest';
import { QuestionImages, decodeQuestionImage, type QuestionImage, type QuestionImageState } from './question-images';
import type { Scan } from './types';
const scan = (id: string) => ({ id } as Scan);
const image = (url: string): QuestionImage => ({ url, width: 800, height: 1200 });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
describe('question images lifetime', () => {
  it('shares batch recovery with an active card and reuses a ready image', async () => {
    let complete!: (result: QuestionImage) => void;
    const loader = vi.fn(() => new Promise<QuestionImage>(resolve => { complete = resolve; }));
    const store = new QuestionImages(loader, vi.fn());
    store.subscribe(scan('same'), vi.fn());
    const recovered = store.recover(scan('same'), new AbortController().signal);
    expect(loader).toHaveBeenCalledTimes(1); complete(image('shared')); await recovered;
    await store.recover(scan('same'), new AbortController().signal);
    expect(loader).toHaveBeenCalledTimes(1); store.dispose();
  });
  it('cancels an offscreen batch recovery without starting later queued images', async () => {
    const loader = vi.fn((_scan: Scan, _cloud: boolean, signal: AbortSignal) => new Promise<QuestionImage>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))));
    const store = new QuestionImages(loader, vi.fn()), controller = new AbortController();
    const recovered = store.recover(scan('batch'), controller.signal); const rejected = expect(recovered).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejected; await tick();
    expect(loader).toHaveBeenCalledTimes(1); expect(loader.mock.calls[0][2].aborted).toBe(true); store.dispose();
  });
  it('keeps failure state across scrolling until a manual retry, without keeping decoded images', async () => {
    const loader = vi.fn(async () => { throw new Error('network unavailable'); });
    const store = new QuestionImages(loader), failures = vi.fn(); const unwatch = store.watchFailures(failures);
    for (const id of ['1', '2', '3', '4']) { const stop = store.subscribe(scan(id), vi.fn()); await tick(); stop(); }
    expect(failures).toHaveBeenLastCalledWith(4);
    store.subscribe(scan('1'), vi.fn()); await tick(); expect(loader).toHaveBeenCalledTimes(4);
    store.retry('1', true); await tick(); expect(loader).toHaveBeenCalledTimes(5);
    unwatch(); store.dispose();
  });
  it('shares one decoded photo between several question cards', async () => {
    const loader = vi.fn(async () => image('one')); const revoke = vi.fn(); const store = new QuestionImages(loader, revoke);
    const a = vi.fn(), b = vi.fn(); store.subscribe(scan('1'), a); store.subscribe(scan('1'), b); await tick();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenLastCalledWith({ status: 'ready', image: image('one') });
    expect(b).toHaveBeenLastCalledWith({ status: 'ready', image: image('one') });
    store.dispose(); expect(revoke).toHaveBeenCalledWith(image('one'));
  });
  it('bounds concurrent reads and discards a queued card before it comes into view', async () => {
    const pending: (() => void)[] = [];
    const loader = vi.fn((s: Scan) => new Promise<QuestionImage>(resolve => pending.push(() => resolve(image(s.id)))));
    const store = new QuestionImages(loader, vi.fn());
    store.subscribe(scan('1'), vi.fn()); store.subscribe(scan('2'), vi.fn()); const stop = store.subscribe(scan('3'), vi.fn());
    expect(loader).toHaveBeenCalledTimes(1); stop(); pending[0](); await tick();
    expect(loader).toHaveBeenCalledTimes(2); pending[1](); await tick();
    expect(loader).toHaveBeenCalledTimes(2); store.dispose();
  });
  it('revokes late results after account/student view disposal', async () => {
    let done!: (value: QuestionImage) => void;
    const loader = vi.fn((_s: Scan, _cloud: boolean, _signal: AbortSignal) => new Promise<QuestionImage>(resolve => { done = resolve; }));
    const revoke = vi.fn(), listener = vi.fn(), store = new QuestionImages(loader, revoke);
    store.subscribe(scan('1'), listener); const signal = loader.mock.calls[0][2]; store.dispose();
    expect(signal.aborted).toBe(true); done(image('old-account')); await tick();
    expect(listener).toHaveBeenCalledTimes(1); expect(revoke).toHaveBeenCalledWith(image('old-account'));
  });
  it('never automatically switches missing local images to a cloud read', async () => {
    const loader = vi.fn(async (_s: Scan, cloud: boolean) => { if (!cloud) throw new Error('local missing'); return image('explicit-cloud'); });
    const state = vi.fn(), store = new QuestionImages(loader, vi.fn()); store.subscribe(scan('1'), state); await tick();
    expect(loader).toHaveBeenCalledTimes(1); expect(loader.mock.calls[0][1]).toBe(false);
    expect(state).toHaveBeenLastCalledWith({ status: 'error', message: 'local missing' });
    store.retry('1', true); await tick(); expect(loader.mock.calls[1][1]).toBe(true);
    expect(state).toHaveBeenLastCalledWith({ status: 'ready', image: image('explicit-cloud') }); store.dispose();
  });
  it('retains only two unused images while preserving an image still shown by another card', async () => {
    const loader = vi.fn(async (s: Scan) => image(s.id)), revoke = vi.fn(), store = new QuestionImages(loader, revoke);
    const keep = store.subscribe(scan('keep'), vi.fn()); await tick();
    for (const id of ['1', '2', '3']) { const stop = store.subscribe(scan(id), vi.fn()); await tick(); stop(); }
    expect(revoke).toHaveBeenCalledWith(image('1')); expect(revoke).not.toHaveBeenCalledWith(image('keep'));
    keep(); store.dispose();
  });
  it('cancels an abandoned read and permits the same image to be requested again', async () => {
    const pending: ((value: QuestionImage) => void)[] = [];
    const loader = vi.fn((_s: Scan, _cloud: boolean, _signal: AbortSignal) => new Promise<QuestionImage>(resolve => pending.push(resolve)));
    const revoke = vi.fn(), store = new QuestionImages(loader, revoke), states: QuestionImageState[] = [];
    const stop = store.subscribe(scan('1'), vi.fn()); stop(); store.subscribe(scan('1'), value => states.push(value));
    expect(loader.mock.calls[0][2].aborted).toBe(true);
    pending[0](image('abandoned')); await tick(); pending[1](image('current')); await tick();
    expect(revoke).toHaveBeenCalledWith(image('abandoned'));
    expect(states.at(-1)).toEqual({ status: 'ready', image: image('current') }); store.dispose();
  });
  it('turns a failed rendered image into a visible retry state instead of leaving a blank card', async () => {
    const loader = vi.fn(async (_scan: Scan, _cloud: boolean) => image('rendered')), revoke = vi.fn(), listener = vi.fn();
    const store = new QuestionImages(loader, revoke); store.subscribe(scan('1'), listener); await tick();
    store.imageFailed('1');
    expect(listener).toHaveBeenLastCalledWith({ status: 'error', message: '题图显示失败，请重新读取本机照片' });
    expect(revoke).toHaveBeenCalledTimes(1); store.imageFailed('1'); expect(revoke).toHaveBeenCalledTimes(1);
    store.retry('1'); await tick(); expect(loader).toHaveBeenCalledTimes(2);
    expect(loader.mock.calls.every(call => call[1] === false)).toBe(true); store.dispose();
  });
  it('aborts a stalled decoder so scrolling/account changes do not block the next image forever', async () => {
    const decoding = { src: '', decode: () => new Promise<void>(() => {}) };
    vi.stubGlobal('Image', class { constructor() { return decoding; } });
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    try {
      const abort = new AbortController(), pending = decodeQuestionImage(new Blob(['synthetic']), abort.signal);
      const url = decoding.src; expect(url).toMatch(/^blob:/); abort.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(decoding.src).toBe(''); expect(revoke).toHaveBeenCalledWith(url);
    } finally { revoke.mockRestore(); vi.unstubAllGlobals(); }
  });
});
