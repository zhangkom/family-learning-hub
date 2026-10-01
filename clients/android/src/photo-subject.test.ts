import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { photoSubjectKey, readPhotoSubject, rememberPhotoSubject } from './photo-subject';
import { emptyQuestion } from './regions';

describe('photo subject choice boundaries', () => {
  const key = photoSubjectKey('family-a', 'student-a', 'photo-a');
  beforeEach(() => {
    const entries = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (name: string) => entries.get(name) ?? null,
      setItem: (name: string, value: string) => { entries.set(name, value); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  const physics = () => ({ ...emptyQuestion('1'), subject: '物理' as const });
  const chemistry = () => ({ ...emptyQuestion('2'), subject: '化学' as const });

  it('retains an explicit choice on a mixed photo without inferring choice order', () => {
    const a = physics(), b = chemistry();
    expect(readPhotoSubject(key, [a, b])).toBeUndefined();
    rememberPhotoSubject(key, a.id, a.subject);
    expect(readPhotoSubject(key, [b, a])).toBe('物理');
    rememberPhotoSubject(key, b.id, b.subject);
    expect(readPhotoSubject(key, [a, b])).toBe('化学');
  });
  it('does not leak a mixed-photo preference to another family, student or photo', () => {
    const questions = [physics(), chemistry()];
    rememberPhotoSubject(key, questions[0].id, '物理');
    for (const scope of [['family-b', 'student-a', 'photo-a'], ['family-a', 'student-b', 'photo-a'], ['family-a', 'student-a', 'photo-b']]) {
      expect(readPhotoSubject(photoSubjectKey(...scope as [string, string, string]), questions)).toBeUndefined();
    }
  });
  it('reconciles a preference with authoritative changes instead of reviving an old subject', () => {
    const a = physics(), b = chemistry();
    rememberPhotoSubject(key, a.id, '物理');
    expect(readPhotoSubject(key, [{ ...a, subject: '生物' }, b])).toBeUndefined();
    expect(readPhotoSubject(key, [b])).toBe('化学');
    expect(readPhotoSubject(key, [])).toBeUndefined();
  });
  it('keeps an explicitly cleared choice empty across reopen', () => {
    const a = physics();
    rememberPhotoSubject(key, a.id);
    expect(readPhotoSubject(key, [a])).toBeUndefined();
  });
  it('recovers only unanimous valid per-question subjects without usable settings', () => {
    const a = physics();
    localStorage.setItem(key, '{broken');
    expect(readPhotoSubject(key, [a, emptyQuestion('2')])).toBe('物理');
    expect(readPhotoSubject(key, [emptyQuestion('1')])).toBeUndefined();
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
    expect(() => rememberPhotoSubject(key, a.id, '物理')).not.toThrow();
    expect(readPhotoSubject(key, [a])).toBe('物理');
  });
});
