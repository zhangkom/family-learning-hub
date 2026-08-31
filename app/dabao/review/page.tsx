import type { Metadata } from 'next';
import { WeeklyReview } from './weekly-review';

export const metadata: Metadata = { title: '大宝每周错题复盘｜双宝名校计划' };

export default function DabaoReviewPage() {
  return <WeeklyReview />;
}
