import type { Question } from './types';

export function TutoringResult({ question }: { question: Question }) {
  const tutoring = question.tutoring;
  if (!tutoring) return null;
  const result = tutoring.result;
  return <section className="tutoring-result" aria-label="这道题的 AI 分析">
    <h2>AI 讲解与分析</h2>
    {['queued', 'processing'].includes(tutoring.status) && <output>正在读取题框并分析，可以返回错题本稍后查看。</output>}
    {tutoring.status === 'failed' && <p role="alert" className="error">{tutoring.error || '分析未完成'}。错题已保留，可以重新分析。</p>}
    {tutoring.status === 'stale' && <p className="uncertain">题框、科目或作答已有修改。下方是旧分析，请重新分析后再使用。</p>}
    {result && <div className={tutoring.status === 'stale' ? 'stale-analysis' : ''}>
      <p className="hint">AI 生成 · 待核对 · {new Date(result.generatedAt).toLocaleString('zh-CN')}</p>
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
  </section>;
}
