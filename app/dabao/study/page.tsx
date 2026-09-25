import type { Metadata } from 'next';
import { StudyWorkspace } from '@/app/components/study-workspace';

export const metadata: Metadata = { title: '大宝解题方法课｜双宝名校计划' };
export default function SeniorStudyPage() {
  return <StudyWorkspace child="dabao" />;
}
