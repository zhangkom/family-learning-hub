import { describe, expect, it } from 'vitest';
import { questionPrompt, questionRectangles } from './question-presentation';
import type { Question, Region } from './types';

const region = (id: string, kind: Region['kind'], x: number, y: number, width: number, height: number): Region => ({ id, kind, x, y, width, height });
const question = (id: string, regions: Region[], extra: Partial<Question> = {}): Question => ({ id, number: id, prompt: '', diagram: '', regions, knowledgePoints: [], answerSteps: [], uncertainties: [], confirmed: false, ...extra });
describe('original question presentation', () => {
  it('keeps separate boxes apart instead of including intervening questions', () => {
    const q = question('1', [region('bottom', 'figure', .1, .7, .5, .1), region('top', 'stem', .1, .1, .7, .2)]);
    const rectangles = questionRectangles(q, [q], 'paper');
    expect(rectangles.map(r => r.id)).toEqual(['top', 'bottom']);
    expect(rectangles[0].height).toBeCloseTo(.2);
  });
  it('keeps original handwriting in original mode, separate from the paper content', () => {
    const q = question('1', [region('s', 'stem', 0, 0, 1, .2), region('a', 'answer', 0, .2, 1, .2), region('n', 'annotation', 0, .4, 1, .2)]);
    expect(questionRectangles(q, [q], 'original').map(r => r.id)).toEqual(['s', 'a', 'n']);
    expect(questionRectangles(q, [q], 'paper').map(r => r.id)).toEqual(['s']);
  });
  it('retains parent/shared figures and stems without taking their answers or unrelated images', () => {
    const parent = question('parent', [region('p', 'stem', 0, 0, 1, .1), region('f', 'figure', 0, .1, 1, .1), region('a', 'answer', 0, .2, 1, .1)]);
    const child = question('child', [region('s', 'stem', 0, .3, 1, .1)], { parentQuestionId: parent.id, sharedRegionIds: ['f', 'a'] });
    const other = question('other', [region('z', 'figure', 0, .8, 1, .1)]);
    expect(questionRectangles(child, [parent, child, other], 'paper').map(r => r.id)).toEqual(['p', 'f', 's']);
    expect(questionRectangles(child, [parent, child, other], 'figures').map(r => r.id)).toEqual(['f']);
  });
  it('does not show a figure twice when it is already inside the complete question box', () => {
    const q = question('1', [region('s', 'stem', .1, .1, .8, .5), region('f', 'figure', .2, .2, .2, .2)]);
    expect(questionRectangles(q, [q], 'paper').map(r => r.id)).toEqual(['s']);
    expect(questionRectangles(q, [q], 'figures').map(r => r.id)).toEqual(['f']);
  });
  it('clips out-of-bounds boxes and rejects invalid/empty coordinates', () => {
    const q = question('1', [region('valid', 'stem', -.1, -.1, .5, .5), region('outside', 'stem', 1, 1, .2, .2), region('bad', 'stem', NaN, 0, 1, 1), region('negative', 'stem', 0, 0, -1, 1)]);
    expect(questionRectangles(q, [q], 'paper')).toEqual([{ id: 'valid', x: 0, y: 0, width: .4, height: .4 }]);
  });
  it('deduplicates identical geometry even when region IDs differ', () => {
    const q = question('1', [region('a', 'stem', 0, 0, 1, .5), region('b', 'stem', 0, 0, 1, .5)]);
    expect(questionRectangles(q, [q], 'paper').map(r => r.id)).toEqual(['a']);
  });
  it('uses corrected text before AI transcription and never synthesizes missing conditions', () => {
    const q = question('1', [], { prompt: '已核对的完整题干', tutoring: { status: 'needs_review', result: { transcribedPrompt: 'AI 识别' } as NonNullable<NonNullable<Question['tutoring']>['result']> } });
    expect(questionPrompt(q)).toBe('已核对的完整题干');
    expect(questionPrompt({ ...q, prompt: '' })).toBe('AI 识别');
    expect(questionPrompt(question('2', []))).toBe('');
  });
});
