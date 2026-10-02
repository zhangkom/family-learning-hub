import { useEffect, useState } from 'react';
import type { FamilyApi } from './api';
import type { LearningSummary } from '../../../lib/learning-session';

export function useLearningHistory(api: FamilyApi, studentId: string, revision = 0) {
  const [result, setResult] = useState<{ student: string; rows: LearningSummary[]; error: string }>({ student: '', rows: [], error: '' });
  useEffect(() => {
    if (!studentId) return;
    const controller = new AbortController();
    void api.learningSessions(studentId, 0, controller.signal).then(reply => {
      if (!controller.signal.aborted) setResult({ student: studentId, rows: reply.sessions, error: '' });
    }).catch(error => { if (!controller.signal.aborted) setResult({ student: studentId, rows: [], error: error.message }); });
    return () => controller.abort();
  }, [api, studentId, revision]);
  return result.student === studentId ? result : { student: studentId, rows: [], error: '' };
}
export function learningProgress(summary: LearningSummary) {
  if (summary.job) return summary.job.status === 'failed' ? '处理未完成 · 可重试' : summary.job.operation === 'grade' ? '正在批改' : '正在准备题目';
  if (summary.independentRetest) return '已独立通过复测';
  if (summary.taskCount && summary.passedCount === summary.taskCount) return '本组已完成 · 可复测';
  return `${summary.passedCount}/${summary.taskCount} 道已完成`;
}
const draftKey = (owner: string, student: string, key: string) => 'family-learning:learning-draft:' + JSON.stringify([owner, student, key]);
export function readLearningDraft(owner: string, student: string, key: string) {
  try { return localStorage.getItem(draftKey(owner, student, key)) || ''; } catch { return ''; }
}
export function writeLearningDraft(owner: string, student: string, key: string, text: string) {
  try { if (text) localStorage.setItem(draftKey(owner, student, key), text); else localStorage.removeItem(draftKey(owner, student, key)); return true; } catch { return false; }
}
