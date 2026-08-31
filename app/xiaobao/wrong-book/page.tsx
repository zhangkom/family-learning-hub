import type { Metadata } from 'next';
import { WrongQuestionBook } from '@/app/components/wrong-question-book';

export const metadata: Metadata = { title: '小宝错题档案｜双宝名校计划' };

export default function XiaobaoWrongBookPage() {
  return (
    <WrongQuestionBook
      child="xiaobao"
      backHref="/xiaobao"
      backLabel="小宝成长页"
      practiceHref="/xiaobao/practice"
    />
  );
}
