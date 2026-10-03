import type { Metadata } from 'next';
import { appPath } from '@/lib/deployment';
import './globals.css';
import { FamilyProvider } from './components/family-provider';

export const metadata: Metadata = {
  title: '知识棱镜AI',
  description: '收录错题与重点题，整理薄弱知识点，练习、复测与打印相互衔接。',
  icons: { icon: appPath('/favicon.svg') },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><FamilyProvider>{children}</FamilyProvider></body>
    </html>
  );
}
