import { describe, expect, it } from 'vitest';
import { abilityAxes, emptyAbilityAxes } from './ability-evidence';
import { abilityDimensions, abilityGrades, abilityGradeFocus, abilityProfile, abilitySubjects, normalizedAbilityGrade } from '../lib/ability';
import type { WeaknessMaterial } from './weakness-materials';
import type { StoredWeakness } from './weakness-reports';
import type { WeaknessResult } from '../lib/weakness';

function material(n: number, subject = '数学'): WeaknessMaterial {
  return { id: `scan/q${n}`, scanId: 'scan', questionId: `q${n}`, revision: 4, number: String(n), subject, prompt: `原题${n}`, parents: [], diagram: '', knowledgePoints: ['代入计算'], studentEvidence: [] };
}
function attempt(n: number, verdict = 'correct', helped = false): WeaknessMaterial['studentEvidence'][number] {
  return { kind: 'ai_graded_attempt', sessionId: `session${n}`, taskId: `task${n}`, attemptId: `attempt${n}`, taskPrompt: `独立练习条件${n}`, text: `已知量代入得${n}`,
    result: `practice:${verdict}`, helped, feedbackEvidence: [`代入得${n}`], modelFeedback: '合成批改结果' };
}
function report(sources: WeaknessMaterial[], subject = '数学'): StoredWeakness {
  return { id: 'report', studentId: 'student', subject, grade: '初二', revision: 2, status: 'processing', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', sourceVersion: 'version',
    coverage: { total: sources.length, eligible: sources.length, selected: sources.length, omitted: 0, needsReview: 0, limit: 30 }, sources, input: sources, jobId: 'job' };
}
function result(sources: WeaknessMaterial[], subject = '数学', dimensionId = 'calculation'): WeaknessResult {
  return { summary: 'AI待核对的学习建议', limitations: ['仅供参考'], axes: [], focuses: [{ id: 'focus', title: '代入计算', subject, dimensionId, knowledgePoints: ['代入计算'], priority: 'high', basis: 'wrong_question_pattern', reason: '共同考点', practiceDirection: '独立练习', needsReview: true,
    evidence: sources.filter(s => s.subject === subject).map(s => ({ sourceId: s.id, kind: 'question', quote: s.prompt, reason: '共同考查代入' })) }] };
}
const calculation = (sources: WeaknessMaterial[]) => abilityAxes(report(sources), result(sources)).find(a => a.id === 'calculation')!;

describe('per-subject ability evidence', () => {
  it('provides six defined dimensions and grade-specific learning emphases for all six subjects', () => {
    expect(abilitySubjects).toHaveLength(6);
    for (const subject of abilitySubjects) {
      expect(abilityDimensions[subject]).toHaveLength(6);
      expect(new Set(abilityDimensions[subject].map(d => d.id)).size).toBe(6);
      for (const grade of abilityGrades) expect(abilityGradeFocus[subject][grade].length).toBeGreaterThan(5);
    }
    expect(abilityDimensions.数学.map(d => d.label)).toEqual(['概念理解', '运算能力', '逻辑推理', '图形空间', '建模应用', '综合迁移']);
    expect(normalizedAbilityGrade('八年级下')).toBe('初二'); expect(normalizedAbilityGrade('高二（1）班')).toBe('高二');
    expect(abilityProfile('数学').gradeFocus).toContain('待核对');
  });
  it('renders explicit unknown templates before analysis instead of zero or fabricated high scores', () => {
    const empty = emptyAbilityAxes('', '初二'); expect(empty).toHaveLength(36);
    expect(empty.every(a => a.score === null && a.confidence === 'insufficient' && a.evidenceCount === 0)).toBe(true);
    expect(emptyAbilityAxes('物理', '八年级')).toHaveLength(6);
    expect(calculation([material(1), material(2)])).toMatchObject({ score: null, evidenceCount: 0, sourceCount: 0 });
  });
  it('requires at least three independent tasks and two different confirmed original questions', () => {
    const sources = [material(1), material(2)]; sources[0].studentEvidence = [attempt(1), attempt(2), attempt(3)];
    expect(calculation(sources)).toMatchObject({ score: null, evidenceCount: 3, sourceCount: 1 });
    sources[0].studentEvidence = [attempt(1)]; sources[1].studentEvidence = [attempt(2)];
    expect(calculation(sources)).toMatchObject({ score: null, evidenceCount: 2, sourceCount: 2 });
    sources[0].studentEvidence.push(attempt(3));
    expect(calculation(sources)).toMatchObject({ score: 100, evidenceCount: 3, sourceCount: 2, confidence: 'limited' });
  });
  it('balances performance by original question and never counts assisted correct answers', () => {
    const sources = [material(1), material(2)]; sources[0].studentEvidence = [attempt(1), attempt(2)]; sources[1].studentEvidence = [attempt(3, 'incorrect'), attempt(4, 'correct', true)];
    const axis = calculation(sources); expect(axis.score).toBe(50); expect(axis.evidence).toHaveLength(3); expect(axis.summary).toContain('AI 批改');
    expect(axis.evidence.every(e => e.helped === false)).toBe(true); expect(axis.evidence[2].questionId).toBe('q2');
  });
  it('excludes uncertain judgements, original challenge repeats, forged quotations and repeated task prompts', () => {
    const sources = [material(1), material(2)]; sources[0].studentEvidence = [attempt(1), attempt(2)];
    sources[1].studentEvidence = [attempt(3, 'uncertain'), { ...attempt(4), result: 'challenge:correct' }, { ...attempt(5), feedbackEvidence: ['从未写过的答案'] }, { ...attempt(6), taskPrompt: '独立练习条件1' }];
    expect(calculation(sources)).toMatchObject({ score: null, evidenceCount: 2, sourceCount: 1 });
    sources[1].studentEvidence.push({ ...attempt(7), result: 'retest:correct' }); expect(calculation(sources).score).toBe(100);
  });
  it('keeps cross-subject axes separate and does not apply unrelated source evidence', () => {
    const sources = [material(1), material(2), material(3, '物理')]; sources[0].studentEvidence = [attempt(1), attempt(2)]; sources[2].studentEvidence = [attempt(3), attempt(4), attempt(5)];
    const axes = abilityAxes(report(sources, ''), result(sources)); expect(axes).toHaveLength(36);
    expect(axes.find(a => a.subject === '数学' && a.id === 'calculation')).toMatchObject({ score: null, evidenceCount: 2 });
    expect(axes.find(a => a.subject === '物理' && a.id === 'calculation')).toMatchObject({ score: null, evidenceCount: 0 });
    expect(axes.filter(a => a.id !== 'calculation').every(a => a.evidenceCount === 0)).toBe(true);
  });
  it('uses only frozen snapshot evidence and distinguishes broader support without claiming mastery', () => {
    const sources = [material(1), material(2), material(3)]; sources.forEach((source, index) => { source.studentEvidence = [attempt(index * 2 + 1), attempt(index * 2 + 2, 'partial')]; });
    const snapshot = JSON.parse(JSON.stringify(report(sources))) as StoredWeakness;
    sources[0].studentEvidence.push(attempt(100, 'incorrect'));
    const axis = abilityAxes(snapshot, result(snapshot.input)).find(a => a.id === 'calculation')!;
    expect(axis).toMatchObject({ score: 75, evidenceCount: 6, sourceCount: 3, confidence: 'supported' });
    expect(axis.evidence.some(e => e.attemptId === 'attempt100')).toBe(false); expect(axis.summary).toContain('不代表长期掌握');
  });
});
