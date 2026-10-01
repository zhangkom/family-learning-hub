import { describe, expect, it } from 'vitest';
import { adoptCandidates, candidateQuestions, mergeCandidates, overlapsExisting, type CandidateReply } from './candidates';
import { emptyQuestion } from './regions';

const scan = { id: 'photo-a', revision: 4 };
const reply = (): CandidateReply => ({ scanId: scan.id, revision: scan.revision,
  algorithm: 'layout-v1', coordinateSpace: 'oriented-normalized', image: { width: 800, height: 1200 },
  status: 'candidates', warnings: ['LAYOUT_ONLY'], candidates: [
    { id: 'a', order: 0, reason: 'LAYOUT_GAP', region: { x: .1, y: .1, width: .7, height: .1 } },
    { id: 'b', order: 1, reason: 'LAYOUT_GAP', region: { x: .1, y: .5, width: .7, height: .1 } },
  ] });

describe('untrusted candidate suggestions', () => {
  it('creates only unconfirmed local drafts with no subject, answer or saved wrong-book state', () => {
    const questions = candidateQuestions(reply(), scan);
    expect(questions).toHaveLength(2);
    for (const q of questions) {
      expect(q.confirmed).toBe(false); expect(q.subject).toBeUndefined();
      expect(q.tutoring).toBeUndefined(); expect(q.wrongBook).toBeUndefined();
      expect(q.prompt).toBe(''); expect(q.answerSteps).toEqual([]);
    }
    expect(new Set(questions.map((q) => q.id)).size).toBe(2);
  });
  it('rejects stale scans, foreign coordinate systems, excessive or malformed regions', () => {
    const changes = [
      { scanId: 'another-photo' }, { revision: 3 }, { coordinateSpace: 'resized-pixels' },
      { image: { width: 0, height: 100 } }, { candidates: Array(25).fill(reply().candidates[0]) },
      { candidates: [reply().candidates[0], reply().candidates[0]] },
      ...[NaN, Infinity, -1].map((x) => ({ candidates: [{ ...reply().candidates[0], region: { x, y: .1, width: .4, height: .1 } }] })),
      { candidates: [{ ...reply().candidates[0], region: { x: .9, y: .1, width: .2, height: .1 } }] },
      { candidates: [{ ...reply().candidates[0], region: { x: 0, y: 0, width: 0, height: .1 } }] },
      { status: 'manual_required' },
    ];
    for (const changeset of changes) expect(() => candidateQuestions({ ...reply(), ...changeset } as CandidateReply, scan)).toThrow();
    expect(candidateQuestions({ ...reply(), status: 'manual_required', candidates: [] }, scan)).toEqual([]);
  });
  it('adopts only the chosen drafts without modifying old questions or transferring model content', () => {
    const old = { ...emptyQuestion('1'), subject: '化学' as const, prompt: '保留人工校对', wrongBook: { savedAt: 'before' } };
    const suggestions = candidateQuestions(reply(), scan);
    const adopted = adoptCandidates([old], [suggestions[1]], '物理');
    expect(adopted).toHaveLength(2); expect(adopted[0]).toBe(old);
    expect(adopted[1].subject).toBe('物理'); expect(adopted[1].number).toBe('2');
    expect(adopted[1].id).not.toBe(suggestions[1].id);
    expect(adopted[1].regions[0].y).toBe(.5);
    expect(adopted[1].regions[0].id).not.toBe(suggestions[1].regions[0].id);
    expect(suggestions[1].subject).toBeUndefined();
    expect(() => adoptCandidates(Array.from({ length: 100 }, () => old), [suggestions[0]], '物理')).toThrow();
  });
  it('merges selected candidate bounds and detects overlap without mutating old frames', () => {
    const suggestions = candidateQuestions(reply(), scan);
    const merged = mergeCandidates(suggestions, suggestions.map((q) => q.id));
    expect(merged).toHaveLength(1); expect(suggestions).toHaveLength(2);
    expect(merged[0].regions[0].height).toBeCloseTo(.5);
    expect(overlapsExisting(merged[0], [suggestions[0]])).toBe(true);
    expect(overlapsExisting(suggestions[0], [suggestions[1]])).toBe(false);
  });
});
