import { describe, expect, it } from 'vitest';
import { questionKnowledgeCards, questionKnowledgeCatalog } from './question-knowledge';

describe('offline subject-specific knowledge cards', () => {
  it('matches explicit aliases, preserves input order and deduplicates the same concept', () => {
    const question = { subject: '物理', knowledgePoints: ['平抛运动的分解', '平抛运动', ' 牛顿第二定律 ', '待补内容', '待补内容'] };
    const original = JSON.stringify(question), result = questionKnowledgeCards(question);
    expect(result.matched.map(card => card.id)).toEqual(['p-projectile', 'p-newton']);
    expect(result.unmatched).toEqual(['待补内容']); expect(result.isReference).toBe(true); expect(JSON.stringify(question)).toBe(original);
  });
  it('does not guess from a substring, a broad term or a label from another subject', () => {
    expect(questionKnowledgeCards({ subject: '物理', knowledgePoints: ['复杂平抛运动综合题', '化学平衡移动', '实验设计'] })).toMatchObject({ matched: [], unmatched: ['复杂平抛运动综合题', '化学平衡移动', '实验设计'] });
    expect(questionKnowledgeCards({ subject: '化学', knowledgePoints: ['自然选择'] }).matched).toEqual([]);
    expect(questionKnowledgeCards({ knowledgePoints: ['平抛运动'] }).unmatched).toEqual(['平抛运动']);
  });
  it.each([
    ['生物', ['基因定位', '遗传实验设计', '杂交后代分析', '性别决定', '性别表现与基因型']],
    ['语文', ['语言特色', '文言文阅读']],
    ['化学', ['电解质环境', '有机反应计量']],
  ])('keeps broader %s labels unmatched instead of substituting one narrow subtopic', (subject, labels) => {
    const result = questionKnowledgeCards({ subject: subject as string, knowledgePoints: labels as string[] });
    expect(result.matched).toEqual([]); expect(result.unmatched).toEqual(labels);
  });
  it('reports empty material honestly and returns independent arrays across calls', () => {
    expect(questionKnowledgeCards({})).toEqual({ subject: '', matched: [], unmatched: [], isReference: true });
    const first = questionKnowledgeCards({ subject: '生物', knowledgePoints: ['DNA结构'] });
    (first.matched[0].formulas as string[]).push('synthetic change');
    expect(questionKnowledgeCards({ subject: '生物', knowledgePoints: ['DNA结构'] }).matched[0].formulas).not.toContain('synthetic change');
  });
  it('uses broad reference cards for broad labels without claiming a narrow subtopic', () => {
    expect(questionKnowledgeCards({ subject: '生物', knowledgePoints: ['有丝分裂与减数分裂', '染色体行为', 'DNA含量变化'] }).matched.map(c => c.id)).toEqual(['b-division-compare']);
    expect(questionKnowledgeCards({ subject: '化学', knowledgePoints: ['化学与生活', '环境与材料'] }).matched.map(c => c.id)).toEqual(['c-life-materials']);
    expect(questionKnowledgeCards({ subject: '化学', knowledgePoints: ['无机物转化', '反应条件'] }).matched.map(c => c.id)).toEqual(['c-inorganic-transform']);
  });
  it('keeps every catalog label unique within its subject and every card nonempty', () => {
    const ids = new Set<string>(), labels = new Set<string>();
    for (const card of questionKnowledgeCatalog) {
      expect(ids.has(card.id)).toBe(false); ids.add(card.id);
      expect(card.concept.length).toBeGreaterThan(10); expect(card.pitfalls.length).toBeGreaterThan(0);
      for (const label of card.labels) {
        const key = `${card.subject}/${label}`; expect(labels.has(key)).toBe(false); labels.add(key);
        expect(questionKnowledgeCards({ subject: card.subject, knowledgePoints: [label] }).matched[0].id).toBe(card.id);
      }
    }
    expect(new Set(questionKnowledgeCatalog.map(card => card.subject))).toEqual(new Set(['数学', '物理', '化学', '生物', '语文', '英语', '地理']));
  });
  it('retains the conditions that prevent common misleading formula applications', () => {
    const read = (subject: string, label: string) => JSON.stringify(questionKnowledgeCards({ subject, knowledgePoints: [label] }).matched);
    expect(read('物理', '平抛运动')).toContain('忽略空气阻力');
    expect(read('物理', '圆周运动临界条件')).toContain('轻杆');
    expect(read('化学', '反应自发方向')).toContain('恒温恒压');
    expect(read('化学', '化学反应速率计算')).toContain('恒容');
    expect(read('化学', '电解池放电顺序')).toContain('恒定电流');
    expect(read('化学', '化学平衡常数表达式')).toContain('开尔文');
    expect(read('生物', '基因频率计算')).toContain('随机交配');
    expect(read('生物', '自由组合定律')).toContain('连锁');
    expect(read('地理', '地方时与区时')).toContain('东加西减');
    expect(read('地理', '地方时与区时')).toContain('快1小时');
  });
});
