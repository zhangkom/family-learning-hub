import { describe, expect, it, vi } from 'vitest';
import { QuestionImages, type QuestionImage, type QuestionImageState } from './question-images';
import type { Scan } from './types';
const scan = (id: string) => ({ id } as Scan);
const image = (url: string): QuestionImage => ({ url, width: 800, height: 1200 });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
describe('question images lifetime', () => {
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
});
