import type { Metadata } from 'next';
import { PracticeHub } from '@/app/components/practice-hub';
import { seniorGradeTwoStarters } from '@/lib/practice';

export const metadata: Metadata = { title: '大宝高二四科周练｜双宝名校计划' };

export default function DabaoPracticePage() {
  return (
    <PracticeHub
      child="dabao"
      backHref="/dabao"
      backLabel="大宝成长页"
      eyebrow="高二 · 数学 / 物理 / 化学 / 生物"
      title="一周四科，只练能迁移的典型模型"
      description="每科从一个典型母题组出发，题目依据高中课程标准重新命制，训练定义、模型、证据和表达。回家后先做一页，再结合扫描错题补充同类变式；不直接复制“必刷题”等商业题库。"
      cadence="住校期间积累问题；周末选 1–2 科限时完成并复盘错题。"
      sheets={seniorGradeTwoStarters}
      subjects={[
        { name: '数学', note: '椭圆定义与参数互译', active: true },
        { name: '物理', note: '电场方向、功与能', active: true },
        { name: '化学', note: '速率与化学平衡', active: true },
        { name: '生物', note: '遗传规律与证据', active: true },
      ]}
      sourceLinks={[
        {
          label: '高中课程标准',
          href: 'https://www.moe.gov.cn/srcsite/A26/s8001/202006/t20200603_462199.html',
        },
        {
          label: '深圳高考科目说明',
          href: 'https://szeb.sz.gov.cn/szzkw/zkgg/gkxx/content/post_11665099.html',
        },
      ]}
      wrongBookHref="/dabao/wrong-book"
    />
  );
}
