import { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { questionDifficultyStars, type DifficultyStars } from '../../../lib/question-difficulty';
import type { FamilyApi } from './api';
import type { Question, Scan } from './types';

export function QuestionDifficulty({ scan, question, api, onUpdate }: { scan: Scan; question: Question; api?: FamilyApi; onUpdate?: (scan: Scan) => void }) {
  const [preview, setPreview] = useState<DifficultyStars>(), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const active = useRef(true), pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => { active.current = true; return () => { active.current = false; pending.current?.abort(); }; }, [api, scan.id, scan.studentId, question.id]);
  const stars = preview ?? questionDifficultyStars(question);
  async function save(value: DifficultyStars) {
    if (!api || !onUpdate || pending.current || question.difficulty?.source === 'user' && question.difficulty.stars === value) return;
    const abort = new AbortController(); pending.current = abort; setPreview(value); setSaving(true); setError('');
    try {
      const { scan: next } = await api.setQuestionDifficulty(scan, question.id, value, abort.signal);
      const saved = next.questions.find(item => item.id === question.id)?.difficulty;
      if (next.id !== scan.id || next.studentId !== scan.studentId || next.revision <= scan.revision || saved?.source !== 'user' || saved.stars !== value) throw new Error('星级保存回执不匹配，请刷新题目后重试');
      if (active.current && !abort.signal.aborted) onUpdate(next);
    } catch (e) {
      if (active.current && !abort.signal.aborted) setError((e as Error).message || '难度未保存，请重试');
    } finally {
      if (pending.current === abort) pending.current = undefined;
      if (active.current && !abort.signal.aborted) { setPreview(undefined); setSaving(false); }
    }
  }
  return <div className="question-difficulty" aria-label="题目难度">
    <span>难度</span><fieldset className="difficulty-stars" aria-label="设置题目难度">{([1,2,3,4,5] as const).map(value => <button key={value} type="button" aria-label={`难度 ${value} 星`} aria-pressed={stars === value} disabled={saving || !api || !onUpdate} onClick={() => void save(value)}><Star size={20} fill={value <= stars ? 'currentColor' : 'none'} className={value <= stars ? 'is-filled' : ''} /></button>)}</fieldset>
    <small aria-live="polite">{saving ? '正在保存…' : `${stars} 星${question.difficulty ? '' : ' · 默认'}`}</small>
    {error && <output role="alert">未保存，已恢复原星级。{error}</output>}
  </div>;
}
