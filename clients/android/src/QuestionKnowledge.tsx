import { useMemo } from 'react';
import { questionKnowledgeCards } from '../../../lib/question-knowledge';
import type { Question } from './types';

/** Bundled reference material only: opening this view never requests an analysis. */
export function QuestionKnowledge({ question }: { question: Pick<Question, 'subject' | 'knowledgePoints'> }) {
  const { subject, knowledgePoints } = question;
  const knowledge = useMemo(() => questionKnowledgeCards({ subject, knowledgePoints }), [subject, knowledgePoints]);
  const labels = [...new Set(question.knowledgePoints.map(label => label.trim()).filter(Boolean))];
  return <section className="question-knowledge" aria-label="本题知识点">
    <p className="knowledge-reference-note">关键概念与公式 · 用于回顾本题知识</p>
    {labels.length ? <div className="knowledge-saved-labels" aria-label="本题已保存的知识标签">{labels.map(label => <span key={label}>{label}</span>)}</div>
      : <p className="knowledge-unmatched">这道题还没有知识标签，可进入题目详情核对补充。</p>}
    {knowledge.matched.map(card => <article className="knowledge-reference-card" key={card.id}>
      <h3>{card.title}</h3><p>{card.concept}</p>
      {card.formulas.length > 0 && <div className="knowledge-formulas"><h4>常用公式</h4>{card.formulas.map(formula => <p key={formula}>{formula}</p>)}</div>}
      {card.pitfalls.length > 0 && <div><h4>易混点</h4><ul>{card.pitfalls.map(pitfall => <li key={pitfall}>{pitfall}</li>)}</ul></div>}
    </article>)}
    {knowledge.unmatched.length > 0 && <p className="knowledge-unmatched">{knowledge.unmatched.join('、')}：这部分知识说明待补充，可先查看上面的知识标签。</p>}
  </section>;
}
