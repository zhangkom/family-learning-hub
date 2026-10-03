import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuestionKnowledge } from './QuestionKnowledge';

vi.mock('../../../lib/question-knowledge', () => ({
  questionKnowledgeCards: ({ subject, knowledgePoints }: { subject?: string; knowledgePoints: string[] }) => ({
    subject, isReference: true,
    matched: subject === '数学' && knowledgePoints.includes('勾股定理') ? [{ id: 'triangle', title: '勾股定理', concept: '直角三角形中两直角边的平方和等于斜边的平方。', formulas: ['a² + b² = c²'], pitfalls: ['仅适用于直角三角形，c 是斜边。'] }] : [],
    unmatched: knowledgePoints.filter(label => !(subject === '数学' && label === '勾股定理')),
  }),
}));

describe('question knowledge reference', () => {
  it('shows saved labels, concepts, formulas and cautions separately from personal evidence', () => {
    const html = renderToStaticMarkup(<QuestionKnowledge question={{ subject: '数学', knowledgePoints: ['勾股定理'] }} />);
    expect(html).toContain('本题已保存的知识标签');
    expect(html).toContain('直角三角形中两直角边');
    expect(html).toContain('a² + b² = c²');
    expect(html).toContain('仅适用于直角三角形');
    expect(html).toContain('关键概念与公式 · 用于回顾本题知识');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('正在读取');
  });
  it('keeps unknown saved labels without inventing an explanation', () => {
    const html = renderToStaticMarkup(<QuestionKnowledge question={{ subject: '物理', knowledgePoints: ['尚未收录的专题'] }} />);
    expect(html).toContain('尚未收录的专题'); expect(html).toContain('这部分知识说明待补充');
    expect(html).not.toContain('knowledge-reference-card');
  });
  it('offers a clear empty-label state and escapes untrusted labels', () => {
    expect(renderToStaticMarkup(<QuestionKnowledge question={{ knowledgePoints: [] }} />)).toContain('还没有知识标签');
    const html = renderToStaticMarkup(<QuestionKnowledge question={{ knowledgePoints: ['<script>alert(1)</script>'] }} />);
    expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;');
  });
});
