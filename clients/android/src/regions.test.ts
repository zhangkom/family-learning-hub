import { describe, expect, it } from 'vitest';
import {
  emptyQuestion,
  mergeQuestions,
  rectangle,
  removeQuestion,
  removeRegion,
} from './regions';

describe('question evidence boundaries', () => {
  it('removing a shared region leaves no dangling references and retains visible writing', () => {
    const a = emptyQuestion('1'),
      b = emptyQuestion('2');
    a.regions = [{ id: 'r', kind: 'stem', x: 0, y: 0, width: 1, height: 0.2 }];
    b.sharedRegionIds = ['r'];
    b.confirmed = true;
    b.answerSteps = [
      {
        id: 's',
        order: 0,
        text: '18',
        regionIds: ['r'],
        author: 'student',
        crossedOut: false,
        uncertain: false,
      },
    ];
    const result = removeRegion([a, b], 'r');
    expect(result[0].regions).toEqual([]);
    expect(result[1].sharedRegionIds).toEqual([]);
    expect(result[1].answerSteps[0]).toMatchObject({
      text: '18',
      regionIds: [],
      uncertain: true,
    });
    expect(result[1].confirmed).toBe(false);
  });
  it('removing a shared stem invalidates confirmation without deleting the child answer', () => {
    const parent = emptyQuestion('1'),
      child = emptyQuestion('1.1');
    parent.regions = [
      { id: 'shared-stem', kind: 'stem', x: 0, y: 0, width: 1, height: 0.2 },
    ];
    child.parentQuestionId = parent.id;
    child.sharedRegionIds = ['shared-stem'];
    child.confirmed = true;
    child.answerSteps = [
      {
        id: 's',
        order: 0,
        text: '18',
        regionIds: [],
        author: 'student',
        crossedOut: false,
        uncertain: false,
      },
    ];
    const result = removeQuestion([parent, child], parent.id);
    expect(result[0].confirmed).toBe(false);
    expect(result[0].parentQuestionId).toBeUndefined();
    expect(result[0].sharedRegionIds).toEqual([]);
    expect(result[0].answerSteps[0].text).toBe('18');
  });
  it('normalizes reverse drags and clamps coordinates to the original image', () => {
    expect(rectangle({ x: 1.2, y: 0.8 }, { x: -0.3, y: 0.2 })).toEqual({
      x: 0,
      y: 0.2,
      width: 1,
      height: 0.6000000000000001,
    });
  });
  it('merges evidence without losing steps or leaving child questions dangling', () => {
    const a = emptyQuestion('1'),
      b = emptyQuestion('2'),
      c = emptyQuestion('2.1');
    b.answerSteps = [
      {
        id: 'step',
        order: 0,
        text: '2x+3=10',
        regionIds: ['answer'],
        author: 'student',
        crossedOut: false,
        uncertain: true,
      },
    ];
    b.regions = [
      { id: 'answer', kind: 'answer', x: 0, y: 0, width: 1, height: 0.2 },
    ];
    c.parentQuestionId = b.id;
    const merged = mergeQuestions([a, b, c], b.id, a.id);
    expect(merged).toHaveLength(2);
    expect(merged[0].answerSteps[0].regionIds).toEqual(['answer']);
    expect(merged[0].confirmed).toBe(false);
    expect(merged[1].parentQuestionId).toBe(a.id);
  });
  it('refuses a merge that makes a question its own parent', () => {
    const a = emptyQuestion('1'),
      b = emptyQuestion('1.1');
    b.parentQuestionId = a.id;
    expect(() => mergeQuestions([a, b], a.id, b.id)).toThrow();
  });
});
