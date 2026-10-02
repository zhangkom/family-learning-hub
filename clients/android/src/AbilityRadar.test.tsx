import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AbilityRadar, type AbilityAxis } from './AbilityRadar';

const axes: AbilityAxis[] = [
  { id: 'concept', label: '概念理解', score: 82, evidenceCount: 8, confidence: 'supported' },
  { id: 'calculation', label: '运算能力', score: 76, evidenceCount: 7, confidence: 'supported' },
  { id: 'reasoning', label: '逻辑推理', score: 48, evidenceCount: 3, confidence: 'limited' },
  { id: 'spatial', label: '图形空间', score: 68, evidenceCount: 6, confidence: 'supported' },
  { id: 'modelling', label: '建模应用', score: 35, evidenceCount: 4, confidence: 'limited', summary: '文字条件转成等量关系仍需练习。' },
  { id: 'transfer', label: '综合迁移', score: 42, evidenceCount: 2, confidence: 'limited' },
];
const render = (values: AbilityAxis[] = axes, selectedId = 'modelling') => renderToStaticMarkup(
  <AbilityRadar axes={values} selectedId={selectedId} onSelect={() => {}} subject="数学" />,
);

describe('evidence-based ability radar', () => {
  it('draws a closed scored shape only when every dimension has a valid evaluation', () => {
    const html = render();
    expect(html.match(/data-ability-shape="complete"/g)).toHaveLength(1);
    expect(html.match(/data-ability-point=/g)).toHaveLength(6);
    expect(html).not.toContain('data-ability-segment=');
    expect(html).toContain('数学能力雷达图');
    expect(html).toContain('已评估 6/6 个维度');
  });

  it('keeps missing dimensions unscored and connects only evaluated neighbours', () => {
    const values = axes.map((axis, i) => i === 2 || i === 5 ? { ...axis, score: null, confidence: 'insufficient' as const } : axis);
    const html = render(values);
    expect(html).not.toContain('data-ability-shape=');
    expect(html.match(/data-ability-point=/g)).toHaveLength(4);
    expect(html).not.toContain('data-ability-point="reasoning"');
    expect(html).not.toContain('data-ability-point="transfer"');
    expect(html.match(/data-ability-segment=/g)).toHaveLength(2);
    expect(html).toContain('data-ability-segment="concept:calculation"');
    expect(html).toContain('data-ability-segment="spatial:modelling"');
    expect(html).not.toContain('data-ability-segment="calculation:spatial"');
    expect(html).toContain('逻辑推理，待评估');
    expect(html).toContain('其余维度待评估');
  });

  it('shows pending assessment without a zero-shaped polygon when all scores are unknown', () => {
    const html = render(axes.map(axis => ({ ...axis, score: null, evidenceCount: 0, confidence: 'insufficient' })));
    expect(html).not.toContain('data-ability-shape=');
    expect(html).not.toContain('data-ability-point=');
    expect(html).not.toContain('data-ability-segment=');
    expect(html).toContain('各维度待评估');
    expect(html.match(/type="button"/g)).toHaveLength(6);
  });

  it('distinguishes a verified zero score from an unknown score', () => {
    const values = axes.map((axis, i) => i === 0 ? { ...axis, score: 0 } : i === 1 ? { ...axis, score: null } : axis);
    const html = render(values, 'concept');
    expect(html).toContain('data-ability-point="concept" data-score="0"');
    expect(html).not.toContain('data-ability-point="calculation"');
    expect(html).toContain('概念理解，能力参考水平 0 分');
    expect(html).toContain('运算能力，待评估');
  });

  it('rejects invalid or insufficiently supported scores instead of clamping them into apparent ability', () => {
    const values = axes.map((axis, i) => ({ ...axis, score: [NaN, Infinity, -1, 101, 92, null][i], confidence: i === 4 ? 'insufficient' as const : axis.confidence }));
    const html = render(values);
    expect(html).not.toContain('data-ability-point=');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
    expect(html).toContain('建模应用，待评估');
  });

  it('exposes controlled selection, evidence confidence and the supplied summary without inventing values', () => {
    const html = render();
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('建模应用，能力参考水平 35 分，4 条依据，证据有限');
    expect(html).toContain('文字条件转成等量关系仍需练习。');
    expect(html).toContain('aria-live="polite"');
    const changed = render(axes, 'concept');
    expect(changed.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(changed).not.toContain('文字条件转成等量关系仍需练习。');
    const unselected = render(axes, 'missing');
    expect(unselected).not.toContain('aria-pressed="true"');
    expect(unselected).not.toContain('ability-radar-detail');
  });

  it('keeps empty or incomplete dimension sets readable without inserting example dimensions', () => {
    const empty = render([]);
    expect(empty).toContain('该科目暂无能力评价');
    expect(empty).not.toContain('<svg');
    expect(empty).not.toContain('概念理解');
    const pair = render(axes.slice(0, 2), 'concept');
    expect(pair).toContain('能力维度尚未齐全');
    expect(pair).not.toContain('data-ability-shape=');
    expect(pair.match(/type="button"/g)).toHaveLength(2);
  });

  it('preserves full dimension labels and safely renders supplied text', () => {
    const values = axes.map((axis, i) => i === 0 ? { ...axis, label: '文字条件与数量关系转化', summary: '<script>unsafe</script>' } : axis);
    const html = render(values, 'concept');
    expect(html).toContain('文字条件与数量关系转化，能力参考水平');
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
});
