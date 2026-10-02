import { describe, expect, it } from 'vitest';
import { collectKnowledge } from './QuestionLibrary';
import type { Question, Scan } from './types';

const item = (id: string, subject: Question['subject'], knowledgePoints: string[]) => ({
  scan: { id: `photo-${id}` } as Scan,
  question: { id, subject, knowledgePoints } as Question,
});
describe('knowledge groups', () => {
  it('counts a question once per trimmed point, excluding empty placeholders', () => {
    const groups = collectKnowledge([item('1', '数学', [' 加法 ', '加法', '', '待确认'])]);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('加法');
    expect(groups[0].items.map(value => value.question.id)).toEqual(['1']);
  });
  it('keeps identically named points in different subjects separate', () => {
    const groups = collectKnowledge([item('1', '数学', ['单位换算']), item('2', '物理', ['单位换算']), item('3', '数学', ['单位换算'])]);
    expect(groups.map(group => [group.subject, group.items.length])).toEqual([['数学', 2], ['物理', 1]]);
    expect(groups[1].items[0].scan.id).toBe('photo-2');
  });
  it('retains unset subjects explicitly without guessing from the photo', () => {
    expect(collectKnowledge([item('1', undefined, ['待选学科知识点'])])[0].subject).toBe('待选科目');
  });
});
