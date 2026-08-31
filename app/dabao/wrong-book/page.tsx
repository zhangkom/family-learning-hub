import type { Metadata } from 'next';
import { WrongQuestionBook } from '@/app/components/wrong-question-book';

export const metadata: Metadata = { title: '大宝错题档案｜双宝名校计划' };

export default function DabaoWrongBookPage() {
  return (
    <WrongQuestionBook
      child="dabao"
      backHref="/dabao"
      backLabel="大宝成长页"
      practiceHref="/dabao/practice"
    />
  );
}
