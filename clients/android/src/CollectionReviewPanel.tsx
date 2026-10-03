import { useState } from 'react';
import type { CollectionDecision, CollectionReviewInput, QuestionCollectionReview } from '../../../lib/question-collection';

export type CollectionReviewDraft = Omit<CollectionReviewInput, 'revision' | 'studentId'>;
type SavedReview = Pick<QuestionCollectionReview, 'decision' | 'materialStatus' | 'reason' | 'reviewedAt'> & { status?: QuestionCollectionReview['status'] };
const decisions: { value: CollectionDecision; label: string }[] = [
  { value: 'pending', label: '继续待确认' }, { value: 'wrong', label: '收为错题' },
  { value: 'focus', label: '收为重点题' }, { value: 'both', label: '错题和重点题' },
  { value: 'none', label: '不收录，保留原资料' },
];

/** Collection decisions are explicit server revisions, separate from text confirmation. */
export function CollectionReviewPanel({ pending, saved, disabledReason, completionBlocked, onSubmit }: {
  pending: boolean; saved?: SavedReview; disabledReason: string; completionBlocked: string;
  onSubmit: (input: CollectionReviewDraft) => Promise<boolean>;
}) {
  const [decision, setDecision] = useState<CollectionDecision>('pending');
  const [complete, setComplete] = useState(false), [reason, setReason] = useState(''), [submitting, setSubmitting] = useState(false);
  const [materialEvidence, setMaterialEvidence] = useState('');
  const [error, setError] = useState('');
  const blocking = disabledReason || (complete ? completionBlocked || (materialEvidence.trim().length < 8 ? '请具体说明材料完整的核对依据（至少 8 字）' : '') : '') || (reason.trim().length < 2 ? '请填写这次复核的依据（至少 2 字）' : '');
  async function submit() {
    if (blocking || submitting) return;
    setSubmitting(true); setError('');
    try {
      if (await onSubmit({ decision, materialStatus: complete ? 'complete' : 'incomplete', reason: reason.trim(), ...(complete ? { materialEvidence: materialEvidence.trim() } : {}) })) { setReason(''); setComplete(false); setMaterialEvidence(''); }
    } catch (error) { setError(error instanceof Error ? error.message : '复核未保存，请重试'); }
    finally { setSubmitting(false); }
  }
  return <details className="collection-review-panel" open={pending}>
    <summary>人工复核收录{pending ? ' · 待处理' : ''}</summary>
    <p className="hint">题干校对与收录判断分开保存。可以先收录并保留待补全；材料未补全时不能开始练习。</p>
    {saved && <p className="collection-review-saved">上次复核：{decisions.find(item => item.value === saved.decision)?.label} · {saved.status === 'stale' ? '题目已修改，请重新复核' : saved.materialStatus === 'complete' ? '材料已核对' : '材料待补全'}。{saved.reason}</p>}
    <label>这次收录判断<select aria-label="这次收录判断" value={decision} disabled={!!disabledReason || submitting} onChange={event => setDecision(event.target.value as CollectionDecision)}>{decisions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    <label className="confirm-check"><input type="checkbox" checked={complete} disabled={!!disabledReason || !!completionBlocked || submitting} onChange={event => setComplete(event.target.checked)} />完整题干、选项、图表和关联续页已核对</label>
    {completionBlocked && <p className="hint">{completionBlocked}。仍可决定是否收录，材料保留待补全。</p>}
    {complete && <label>材料完整的核对依据<textarea aria-label="材料完整的核对依据" value={materialEvidence} maxLength={1000} disabled={!!disabledReason || submitting} placeholder="说明核对过的题干、配图、选项和续页，或这次补全了什么" onChange={event => setMaterialEvidence(event.target.value)} /></label>}
    <label>复核依据<textarea aria-label="复核依据" value={reason} maxLength={1000} disabled={!!disabledReason || submitting} placeholder="例如：已补全续页并核对红笔订正；或说明仍缺少哪些内容" onChange={event => setReason(event.target.value)} /></label>
    {decision !== 'pending' && <p className="hint">保存后更新错题或重点题收录；原资料与纸面批改依据保留。</p>}
    {blocking && <p className="hint">{blocking}。</p>}
    {error && <output className="error" role="alert">{error}</output>}
    <button type="button" disabled={!!blocking || submitting} onClick={() => void submit()}>{submitting ? '正在保存复核…' : '保存人工复核'}</button>
  </details>;
}
