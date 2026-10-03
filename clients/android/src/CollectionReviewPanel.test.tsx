import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CollectionReviewPanel } from './CollectionReviewPanel';

const render = (props: Partial<Parameters<typeof CollectionReviewPanel>[0]> = {}) => renderToStaticMarkup(<CollectionReviewPanel pending disabledReason="" completionBlocked="" onSubmit={async () => true} {...props} />);
describe('explicit collection review entry', () => {
  it('separates collection decision from confirming text and requires a reason', () => {
    const html = render();
    expect(html).toContain('人工复核收录 · 待处理'); expect(html).toContain('题干校对与收录判断分开保存');
    expect(html).toContain('完整题干、选项、图表和关联续页已核对');
    expect(html).toContain('请填写这次复核的依据'); expect(html).toContain('disabled="">保存人工复核');
    expect(html).toContain('不收录，保留原资料');
  });
  it('explains incomplete materials and retains saved human rationale without erasing paper marks', () => {
    const html = render({ completionBlocked: '请先补全并保存完整题干', saved: { decision: 'pending', materialStatus: 'incomplete', reason: '右侧条件缺失', reviewedAt: '2026-10-03' } });
    expect(html).toContain('右侧条件缺失'); expect(html).toContain('仍可决定是否收录，材料保留待补全');
  });
  it('blocks dirty or conflicting revisions with an actionable reason', () => {
    expect(render({ disabledReason: '请先保存这次校对' })).toContain('请先保存这次校对');
  });
});
