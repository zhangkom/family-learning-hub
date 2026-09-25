import type { Metadata } from 'next';
import { appPath } from '@/lib/deployment';
import './globals.css';

export const metadata: Metadata = {
  title: '双宝名校计划',
  description: '为两个孩子建立目标、计划、错题与家庭复盘闭环。',
  icons: { icon: appPath('/favicon.svg') },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
