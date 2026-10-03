import { describe, expect, it } from 'vitest';
import { questionLearningReadiness } from './question-context';
import type { Question } from './mobile';
const q: Question = { id: 'q', number: '1', subject: '数学', confirmed: true, prompt: '合成题干', diagram: '', regions: [{ id: 'r', kind: 'stem', x: 0, y: 0, width: 1, height: 1 }], answerSteps: [], knowledgePoints: [], uncertainties: [] };
describe('learning source readiness', () => {
  it('requires existing confirmed shared material even for a confirmed child', () => {
    expect(questionLearningReadiness(q, [q])).toBe('');
    expect(questionLearningReadiness({ ...q, parentQuestionId: 'missing' }, [q])).toContain('父题');
    expect(questionLearningReadiness({ ...q, sharedRegionIds: ['missing'] }, [q])).toContain('缺失');
    expect(questionLearningReadiness({ ...q, parentQuestionId: 'q' }, [q])).toContain('循环');
    expect(questionLearningReadiness({ ...q, paperMark: { classification: 'pending', ruleIds: [], evidence: [], reviewedAt: '', reviewedBy: 'codex-manual', independentAssessment: false } }, [q])).toContain('待补全');
    const pending: Question = { ...q, id: 'parent', paperMark: { classification: 'pending', ruleIds: [], evidence: [], reviewedAt: '', reviewedBy: 'codex-manual', independentAssessment: false }, regions: [{ ...q.regions[0], id: 'pr' }] };
    expect(questionLearningReadiness({ ...q, sharedRegionIds: ['pr'] }, [q, pending])).toContain('待补全');
    expect(questionLearningReadiness({ ...q, parentQuestionId: 'parent' }, [q, pending])).toContain('待补全');
  });
});
