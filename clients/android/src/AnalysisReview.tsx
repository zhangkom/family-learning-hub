import { useState } from 'react';
import type { AnalysisIssue, Question, TutoringReviewInput } from './types';

export function AnalysisReview({ question, disabled, onReview, onReanalyze, canReanalyze }: {
  question: Question; disabled?: boolean; onReview: (input: TutoringReviewInput) => Promise<boolean>;
  onReanalyze?: () => void; canReanalyze?: boolean;
}) {
  const tutoring = question.tutoring!, result = tutoring.result!;
  const [editing, setEditing] = useState(false);
  const [issue, setIssue] = useState<AnalysisIssue>(tutoring.review?.issue || 'recognition');
  const [prompt, setPrompt] = useState(question.prompt || result.transcribedPrompt);
  const [note, setNote] = useState(tutoring.review?.note || '');
  async function save(input: TutoringReviewInput) { if (await onReview(input)) setEditing(false); }
  return <section className="analysis-review" aria-label="核对这道题的分析">
    <h3>核对这份分析</h3>
    <p className="hint">核对标记由你保存，不会自动判定孩子已经掌握。</p>
    {!editing ? <div className="button-row">
      <button type="button" disabled={disabled || tutoring.status !== 'needs_review'} onClick={() => void save({ status: 'confirmed' })}>核对无误</button>
      <button type="button" disabled={disabled} onClick={() => setEditing(true)}>纠正／报告问题</button>
    </div> : <div>
      <label>需要核对的问题<select value={issue} disabled={disabled} onChange={e => setIssue(e.target.value as AnalysisIssue)}>
        <option value="recognition">题干识别有误</option><option value="solution">答案或推导有问题</option><option value="incomplete">题图或条件不完整</option>
      </select></label>
      {issue === 'recognition' && <label>核对后的完整题干<textarea rows={5} maxLength={12000} value={prompt} disabled={disabled} onChange={e => setPrompt(e.target.value)} /></label>}
      <label>{issue === 'recognition' ? '补充说明（选填）' : '需要改正或补充的地方'}<textarea rows={3} maxLength={2000} value={note} disabled={disabled}
        placeholder="例如：第2步漏乘了系数，或题图缺少右侧图形" onChange={e => setNote(e.target.value)} /></label>
      <div className="button-row"><button type="button" disabled={disabled || !(issue === 'recognition' ? prompt.trim() : note.trim())}
        onClick={() => void save({ status: 'flagged', issue, note, ...(issue === 'recognition' ? { correctedPrompt: prompt } : {}) })}>保存核对意见</button>
        <button type="button" disabled={disabled} onClick={() => setEditing(false)}>取消修改</button></div>
      <p className="hint">保存只记录问题；重新分析时才会再次调用 AI。</p>
    </div>}
    {tutoring.review?.status === 'flagged' && onReanalyze && <button type="button" className="primary" disabled={disabled || !canReanalyze} onClick={onReanalyze}>按校对内容重新分析</button>}
  </section>;
}
