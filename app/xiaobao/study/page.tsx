import type { Metadata } from 'next';
import { DailyStudy } from './daily-study';

export const metadata: Metadata = { title: '小宝每日难点｜双宝名校计划' };

export default function XiaobaoStudyPage() {
  return <DailyStudy />;
}
