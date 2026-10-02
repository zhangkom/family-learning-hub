import type { StoredWeakness } from './weakness-reports';
import type { WeaknessResult } from '../lib/weakness';
import { abilityProfile, abilitySubjects, type AbilityAxis, type AbilityEvidence } from '../lib/ability';

export function abilityAxes(report: StoredWeakness, result: WeaknessResult): AbilityAxis[] {
  const subjects = report.subject ? [report.subject] : abilitySubjects;
  return subjects.flatMap(subject => {
    const profile = abilityProfile(subject, report.grade);
    return profile.dimensions.map(dimension => {
      // The model may map a grounded multi-question finding to a known dimension,
      // but it never supplies a score. Only actual, independent graded work counts.
      const sourceIds = new Set(result.focuses.filter(f => f.subject === subject && f.dimensionId === dimension.id).flatMap(f => f.evidence.map(e => e.sourceId)));
      const sources = report.input.filter(s => s.subject === subject && sourceIds.has(s.id));
      const evidence: AbilityEvidence[] = [], prompts = new Set<string>();
      // Read only the report's immutable, student-scoped snapshot. Later answers
      // make the report stale; they never silently rewrite an older radar score.
      for (const source of sources) {
        for (const attempt of source.studentEvidence) {
          // Repeating the original challenge is not a new independent test item.
          const [kind, verdict] = (attempt.result || '').split(':');
          if (attempt.kind !== 'ai_graded_attempt' || !['practice', 'retest'].includes(kind)) continue;
          const key = (attempt.taskPrompt || '').replace(/\s/g, '');
          if (!key || prompts.has(key)) continue;
          if (attempt.helped !== false || !['correct', 'partial', 'incorrect'].includes(verdict)) continue;
          if (!attempt.sessionId || !attempt.taskId || !attempt.attemptId || !attempt.feedbackEvidence?.length || attempt.feedbackEvidence.some(q => !attempt.text.includes(q))) continue;
          prompts.add(key);
          evidence.push({ sessionId: attempt.sessionId, taskId: attempt.taskId, attemptId: attempt.attemptId, scanId: source.scanId, questionId: source.questionId,
            mode: attempt.mode || 'practice', verdict: verdict as AbilityEvidence['verdict'], helped: false, prompt: attempt.taskPrompt!, answer: attempt.text });
        }
      }
      const bySource = new Map<string, number[]>();
      for (const item of evidence) {
        const key = `${item.scanId}/${item.questionId}`, values = bySource.get(key) || [];
        values.push(item.verdict === 'correct' ? 1 : item.verdict === 'partial' ? 0.5 : 0); bySource.set(key, values);
      }
      const sufficient = evidence.length >= 3 && bySource.size >= 2;
      // Balance by original question so a large drill from one source does not
      // overwhelm independent evidence from another. This is a practice index,
      // not a standardized ability measurement or a mastery guarantee.
      const score = sufficient ? Math.round(100 * [...bySource.values()].reduce((sum, scores) => sum + scores.reduce((s, n) => s + n, 0) / scores.length, 0) / bySource.size) : null;
      const confidence = sufficient ? evidence.length >= 6 && bySource.size >= 3 ? 'supported' : 'limited' : 'insufficient';
      return { subject, id: dimension.id, label: dimension.label, score, evidenceCount: evidence.length, sourceCount: bySource.size, confidence,
        summary: sufficient ? '基于 AI 批改的独立作答参考分，按原题均衡计算；不是标准化能力测评，也不代表长期掌握。' : `待评估：目前有 ${evidence.length} 道可用独立作答，来自 ${bySource.size} 道原题；至少需要 3 道独立题、2 道不同原题。`,
        evidence, grade: profile.grade, gradeFocus: profile.gradeFocus } as AbilityAxis;
    });
  });
}

export function emptyAbilityAxes(subject: string, grade?: string): AbilityAxis[] {
  return (subject ? [subject] : abilitySubjects).flatMap(name => {
    const profile = abilityProfile(name, grade);
    return profile.dimensions.map(d => ({ subject: name, id: d.id, label: d.label, score: null, evidenceCount: 0, sourceCount: 0, confidence: 'insufficient' as const,
      summary: '待评估：先分析已确认错题，再积累对应维度至少 3 道独立作答、2 道不同原题的证据。', evidence: [], grade: profile.grade, gradeFocus: profile.gradeFocus }));
  });
}
