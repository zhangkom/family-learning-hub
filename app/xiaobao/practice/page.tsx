import type { Metadata } from 'next';
import { PracticeHub } from '@/app/components/practice-hub';
import { juniorPracticeSheets } from '@/lib/practice';

export const metadata: Metadata = { title: '小宝系统强化训练｜双宝名校计划' };

export default function XiaobaoPracticePage() {
  return (
    <PracticeHub
      child="xiaobao"
      backHref="/xiaobao"
      backLabel="小宝成长页"
      eyebrow="初一 · 深圳课程同步 · 第一阶段"
      title="绝对值与经纬度，从看懂到自己会做"
      description="四周20页方法配套：数学12页、英语4页、地理4页。重点补含字母绝对值与经纬度；保留原有8页几何专题。每页有演算空间和独立家长解析版，题号与在线小课一致。"
      cadence="每天选一页或一节小课，约15分钟；到期复习可以替代新内容。"
      sheets={juniorPracticeSheets}
      subjects={[
        {
          name: '数学',
          note: '绝对值4页 + 基础方法8页；另有几何专题',
          active: true,
        },
        {
          name: '英语',
          note: '句子、主谓、助动词、阅读证据共4页',
          active: true,
        },
        { name: '地理', note: '经纬线、地址、读图、定位共4页', active: true },
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
      wrongBookHref="/xiaobao/wrong-book"
    />
  );
}
