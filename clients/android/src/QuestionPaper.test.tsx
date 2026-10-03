import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuestionPaper, QuestionSource } from './QuestionPaper';
import type { Question, Scan } from './types';

const question: Question = { id: 'q', number: '1', prompt: '如图求三角形面积。', diagram: '一个三角形', confirmed: true,
  regions: [{ id: 'stem', kind: 'stem', x: .1, y: .2, width: .8, height: .3 }], knowledgePoints: [], answerSteps: [], uncertainties: [] };
const image = { url: 'blob:verified-local-photo', width: 1000, height: 1400 };
describe('paper and original are visible distinct views', () => {
  it('shows answer sheet physical page and every composite original separately from archive order', () => {
    const q: Question = { ...question, sourcePage: { documentId: 'd', title: '物理暑假作业（一）', subject: '物理', pageNumber: 5, pageCount: 6, paperPageNumber: 1, paperPageCount: 2, pageRole: 'answer-sheet', revision: 1, photoId: 'answer', sourceParts: [{ photoId: 'paper', originalName: 'IMG_paper.jpg', title: '物理暑假作业（一）', paperPageNumber: 3, pageRole: 'questions', role: 'question' }, { photoId: 'answer', originalName: 'IMG_answer.jpg', paperPageNumber: 1, pageRole: 'answer-sheet', role: 'answer' }] } };
    const html = renderToStaticMarkup(<QuestionSource scan={{ originalName: 'IMG_answer.jpg', questions: [q] } as Scan} question={q} />);
    expect(html).toContain('答题卡 · 第 1 页');
    expect(html).toContain('IMG_paper.jpg');
    expect(html).toContain('第 3 页');
    expect(html).not.toContain('第 5 页');
    const noFooter = { ...q, sourcePage: { ...q.sourcePage!, paperPageNumber: undefined, paperPageCount: undefined, pageRole: 'questions' as const } };
    expect(renderToStaticMarkup(<QuestionSource scan={{ questions: [noFooter] } as Scan} question={noFooter} />)).toContain('第 5 张');
  });
  it('shows confirmed homework provenance while distinguishing paper marks from assessed performance', () => {
    const sourcePage = { documentId: 'document', title: '物理寒假作业3', subject: '物理' as const, pageNumber: 2, pageCount: 4, revision: 1, photoId: 'photo', majorNumber: '二', subNumber: '3' };
    const q: Question = { ...question, sourcePage, paperMark: { classification: 'both', ruleIds: ['red-correction', 'red-star'], evidence: [{ text: '红笔划改 A 为 B；题号前红星' }], reviewedAt: '2026-10-03', reviewedBy: 'codex-manual', independentAssessment: false } };
    const html = renderToStaticMarkup(<QuestionSource scan={{ originalName: 'IMG_1.jpg', questions: [q] } as Scan} question={q} />);
    expect(html).toContain('物理寒假作业3 · 第 2 页 · 第 二 大题 · 第 3 小题');
    expect(html).toContain('IMG_1.jpg'); expect(html).toContain('红笔划改 A 为 B；题号前红星');
    expect(html).toContain('不作为独立测验成绩');
  });
  it('preserves the complete original question when its diagram has not been separately marked', () => {
    const html = renderToStaticMarkup(<QuestionPaper question={question} questions={[question]} image={image} original={false} />);
    expect(html).not.toContain('class="paper-prompt"'); expect(html).toContain('原题题框（含配图）');
    expect(html).toContain('src="blob:verified-local-photo"'); expect(html).toContain('alt="原题题干与配图"');
    expect(html).not.toContain('一个三角形');
  });
  it('switches to the exact saved box with a visible status and no text pretending to be an image', () => {
    const html = renderToStaticMarkup(<QuestionPaper question={question} questions={[question]} image={image} original />);
    expect(html).toContain('原图题框 · 第 1 题'); expect(html).toContain('这道题的原图题框');
    expect(html).not.toContain('如图求三角形面积。');
    const missing = renderToStaticMarkup(<QuestionPaper question={question} questions={[question]} original />);
    expect(missing).toContain('原图题框 · 第 1 题'); expect(missing).not.toContain('如图求三角形面积。');
    expect(missing).not.toContain('<img');
    expect(missing).not.toContain('题图未就绪');
  });
  it('uses the real separate figure, preserving its relative vertical and horizontal crop scale', () => {
    const q: Question = { ...question, regions: [...question.regions, { id: 'figure', kind: 'figure', x: .3, y: .3, width: .4, height: .1 }] };
    const html = renderToStaticMarkup(<QuestionPaper question={q} questions={[q]} image={image} original={false} />);
    expect(html).toContain('alt="原题配图"');
    expect(html).toContain('如图求三角形面积。');
    expect(Number(html.match(/width:([\d.]+)%/)?.[1])).toBeCloseTo(250);
    expect(Number(html.match(/height:([\d.]+)%/)?.[1])).toBeCloseTo(1000);
    expect(html).not.toContain('原题题框（含配图）');
    const unconfirmed = { ...q, confirmed: false };
    const draft = renderToStaticMarkup(<QuestionPaper question={unconfirmed} questions={[unconfirmed]} image={image} original={false} />);
    expect(draft).toContain('原题题框（含配图）'); expect(draft).not.toContain('class="paper-prompt"');
  });
  it('surfaces a broken shared context instead of silently treating the prompt as complete', () => {
    const q = { ...question, parentQuestionId: 'missing-parent' };
    const html = renderToStaticMarkup(<QuestionPaper question={q} questions={[q]} image={image} original={false} />);
    expect(html).toContain('共用题干或配图的来源不完整');
  });
});
