import type { Metadata } from 'next';
import { PracticeHub } from '@/app/components/practice-hub';
import { juniorMathChapterOne } from '@/lib/practice';

export const metadata: Metadata = { title: '小宝系统强化训练｜双宝名校计划' };

export default function XiaobaoPracticePage() {
  return (
    <PracticeHub
      child="xiaobao"
      backHref="/xiaobao"
      backLabel="小宝成长页"
      eyebrow="初一 · 深圳课程同步 · 第一阶段"
      title="数学第一章，8 页走完一个真正的学习闭环"
      description="以深圳公开选用的北师大版七年级上册体系为课程坐标，从识别立体图形到展开、截面与三视图。题目全部重新命制，不复制教辅；每页既可打印，也能在批改后进入错题复习。"
      cadence="平日每天 1 页，或周末完成 2 页；一章结束后再做综合页。"
      sheets={juniorMathChapterOne}
      subjects={[
        { name: '数学', note: '第一章 8 页已开放', active: true },
        { name: '英语', note: '保留入口，下一阶段按单元开放', active: false },
        { name: '物理', note: '初二同步学校进度开启', active: false },
        { name: '化学', note: '初三同步学校进度开启', active: false },
      ]}
      sourceLinks={[
        {
          label: '深圳教材公开目录',
          href: 'https://szeb.sz.gov.cn/gkmlpt/content/8/8905/post_8905784.html',
        },
        {
          label: '义务教育数学课标',
          href: 'https://www.moe.gov.cn/srcsite/A26/s8001/202204/W020220420582346895190.pdf',
        },
      ]}
    />
  );
}
