import type { AnalysisProgress, Question, TutoringReviewInput } from './types';
import { AnalysisStatus } from './AnalysisStatus';
import { AnalysisReview } from './AnalysisReview';

export function TutoringResult({ question, progress, disabled, onReview, onReanalyze, canReanalyze }: {
  question: Question; progress?: AnalysisProgress; disabled?: boolean;
  onReview?: (input: TutoringReviewInput) => Promise<boolean>; onReanalyze?: () => void; canReanalyze?: boolean;
}) {
  const tutoring = question.tutoring;
  if (!tutoring) return null;
  const result = tutoring.result;
  const pending = ['queued', 'processing'].includes(tutoring.status);
  const review = tutoring.review;
  const current = tutoring.status === 'needs_review';
  return <section className="tutoring-result" aria-label="这道题的 AI 分析">
    <h2>AI 讲解与分析</h2>
    {pending && (progress && progress.questionId === question.id ? <AnalysisStatus progress={progress} /> : <output>正在读取题框并分析，可以返回错题本稍后查看。</output>)}
    {tutoring.status === 'failed' && <p role="alert" className="error">{tutoring.error || '分析未完成'}。错题已保留，可以重新分析。</p>}
    {tutoring.status === 'stale' && <p className="uncertain">题目内容已有修改或分析已标记问题，请重新分析后再使用。</p>}
    {result && <div className={!current ? 'stale-analysis' : ''}>
      {!current && <p className="uncertain">以下保留的是上一次分析，本次尚未得到新的有效结果。</p>}
      <p className="hint">AI 生成 · {current && review?.status === 'confirmed' ? '用户已核对' : review?.status === 'flagged' ? '用户已标记问题' : '待核对'} · {new Date(result.generatedAt).toLocaleString('zh-CN')}</p>
      {review?.status === 'flagged' && <div className="uncertain"><strong>已保存核对意见</strong><p>{review.issue === 'recognition' ? '题干识别有误，后续分析采用已校对的题干。' : review.issue === 'solution' ? '答案或推导有问题。' : '题图或条件需要补充。'}</p>{review.note && <p className="analysis-text">{review.note}</p>}</div>}
      <h3>识别题干</h3><p className="analysis-text">{result.transcribedPrompt}</p>
      <h3>参考答案</h3><p className="analysis-text">{result.referenceAnswer}</p>
      <h3>分步讲解</h3><p className="analysis-text">{result.explanation}</p>
      <h3>照片中的作答证据</h3>
      {result.answerEvidence.length ? <ol>{result.answerEvidence.map((evidence, i) => <li key={i}>
        <span className="evidence-author">{evidence.author === 'student' ? '孩子作答' : evidence.author === 'teacher' ? '老师批注' : '作者待确认'}</span>
        <p className="analysis-text">{evidence.text}</p>
      </li>)}</ol> : <p>未看到足够的作答证据，暂不判断错因。</p>}
      {!!result.errorHypotheses.length && <><h3>需要核对的可能错因</h3><ul>{result.errorHypotheses.map((item, i) => <li key={i}>
        {item.text}<small>（依据作答证据 {item.evidenceIndexes.map((index) => index + 1).join('、')}）</small>
      </li>)}</ul></>}
      {!!result.uncertainties.length && <div className="uncertain"><strong>这些地方还需确认</strong><ul>{result.uncertainties.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
    </div>}
    {result && onReview && <AnalysisReview key={`${question.id}|${result.generatedAt}|${question.prompt}`} question={question} disabled={disabled || pending} onReview={onReview} onReanalyze={onReanalyze} canReanalyze={canReanalyze} />}
  </section>;
}
