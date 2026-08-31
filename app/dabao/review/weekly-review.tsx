'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CalendarDays, Camera, Check, ChevronRight, FileSearch, ImagePlus, LoaderCircle, MessageCircleQuestion, Network, ScanLine } from 'lucide-react';
import { WorkbenchHeader } from '@/app/components/workbench-header';

const subjects = ['数学', '物理', '化学', '生物'] as const;
type Subject = (typeof subjects)[number];

const difficultyMap: Record<Subject, string[]> = {
  数学: ['函数与导数', '数列与不等式', '解析几何', '概率统计', '建模与规范证明'],
  物理: ['受力与模型选择', '运动图像', '能量与动量', '电磁场与电路', '实验与数据'],
  化学: ['宏微符号转换', '反应原理', '电化学', '实验与证据', '有机转化'],
  生物: ['结构与功能', '代谢与能量', '遗传与概率', '稳态调节', '实验设计'],
};

type ScanItem = { id: string; subject: string; source: string; originalName: string; status: string; createdAt: string; fileUrl: string };

export function WeeklyReview() {
  const [subject, setSubject] = useState<Subject>('数学');
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [source, setSource] = useState('');
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [uploadMessage, setUploadMessage] = useState('');
  const [scans, setScans] = useState<ScanItem[]>([]);
  const points = useMemo(() => difficultyMap[subject], [subject]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch('/api/scans').then(async (response) => {
        if (!response.ok) throw new Error('history unavailable');
        const data = await response.json() as { items?: ScanItem[] };
        setScans(data.items ?? []);
      }).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const uploadScan = async () => {
    if (!file || !source.trim()) return;
    setUploadState('uploading'); setUploadMessage('');
    const form = new FormData(); form.set('file', file); form.set('subject', subject); form.set('source', source.trim());
    try {
      const response = await fetch('/api/scans', { method: 'POST', body: form });
      const data = await response.json() as { item?: ScanItem; error?: string };
      if (!response.ok || !data.item) throw new Error(data.error || '上传失败，请稍后再试');
      setScans((current) => [data.item!, ...current]);
      setFile(null); setFileName(''); setSource(''); setUploadState('done');
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : '上传失败，请稍后再试');
      setUploadState('error');
    }
  };

  return (
    <main className="plan-page plan-page--coral min-h-screen bg-background text-foreground">
      <WorkbenchHeader backHref="/dabao" backLabel="大宝成长页" />
      <div className="mx-auto max-w-7xl px-5 py-7 lg:px-8 lg:py-9">
        <section className="plan-banner rounded-[1.75rem] p-6 lg:p-8">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div><p className="text-sm font-semibold text-primary">高二 · 每周一次</p><h1 className="mt-2 font-heading text-3xl font-bold tracking-[-0.035em] sm:text-4xl">把这一周的错题讲透</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">扫描原题 → 标明出处 → 定位知识点 → 分步讲解 → 重做与变式 → 定期回看</p></div>
            <div className="rounded-2xl bg-white/75 px-5 py-4"><p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><CalendarDays className="size-4" /> 本周家庭复盘</p><p className="mt-2 font-heading text-xl font-bold">周末 60–90 分钟</p></div>
          </div>
        </section>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.08fr_.92fr]">
          <section className="rounded-3xl border border-border bg-card p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.13em] text-muted-foreground">新建复盘</p><h2 className="mt-1 font-heading text-2xl font-bold">上传一道错题</h2></div><span className="rounded-full bg-[#fff0e9] px-3 py-1.5 text-xs font-bold text-[#a64224]">扫描件不进入 Git</span></div>
            <div className="mt-5 flex gap-2 overflow-x-auto pb-1">{subjects.map((item) => <button key={item} onClick={() => setSubject(item)} className={`min-h-10 shrink-0 rounded-xl px-4 text-sm font-bold ${subject === item ? 'bg-ink text-white' : 'bg-muted text-muted-foreground'}`}>{item}</button>)}</div>
            <label aria-label="上传错题扫描件" className="mt-5 grid min-h-44 cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-border bg-muted/35 p-5 text-center transition hover:border-primary/40 hover:bg-muted/60">
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(event) => { const selected = event.target.files?.[0] ?? null; setFile(selected); setFileName(selected?.name ?? ''); setUploadState('idle'); }} />
              <span><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-card shadow-sm"><ImagePlus className="size-6 text-primary" /></span><span className="mt-3 block font-bold">{fileName || '拍照、扫描或选择 PDF'}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">支持 JPG、PNG、WebP、PDF；单个文件最多 8 MB</span></span>
            </label>
            <label className="mt-4 block text-sm font-bold">题目出处 <span className="text-destructive">*</span><input value={source} onChange={(event) => { setSource(event.target.value); setUploadState('idle'); }} placeholder="例如：学校周测 · 数学卷第 18 题" className="mt-2 min-h-12 w-full rounded-xl border border-input bg-background px-4 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" /></label>
            <button disabled={!file || !source.trim() || uploadState === 'uploading'} onClick={() => void uploadScan()} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40">{uploadState === 'uploading' && <LoaderCircle className="size-4 animate-spin" />} {uploadState === 'uploading' ? '正在安全上传…' : '加入本周复盘'}</button>
            {uploadState === 'done' && <div className="mt-4 rounded-2xl bg-[#e7f5f2] p-4 text-sm text-[#176a62]"><p className="flex items-center gap-2 font-bold"><Check className="size-4" /> 已同步到私人学习空间</p><p className="mt-1 leading-6">换一台电脑登录同一账号，也能在历史错题中打开。</p></div>}
            {uploadState === 'error' && <div className="mt-4 rounded-2xl bg-[#fff0e9] p-4 text-sm text-[#8e3a22]"><p className="font-bold">暂时没有上传成功</p><p className="mt-1 leading-6">{uploadMessage}</p></div>}
          </section>

          <aside className="space-y-5">
            <section className="rounded-3xl bg-ink p-5 text-white"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.13em] text-white/55"><ScanLine className="size-4" /> 每道题的讲透卡</p><div className="mt-4 space-y-3">{[[FileSearch, '1. 识别题目', '保留原图与出处，确认条件没有看错'], [Network, '2. 定位知识', '放回章节网络，指出真正卡点'], [BookOpen, '3. 分步解答', '写清依据、关键转折和规范答案'], [Camera, '4. 图解与变式', '需要时画受力图、函数图或流程图'], [MessageCircleQuestion, '5. 继续追问', '根据孩子回答调整讲法，不强行灌输']].map(([Icon, title, detail]) => { const ItemIcon = Icon as typeof ScanLine; return <div key={title as string} className="flex gap-3"><ItemIcon className="mt-0.5 size-5 shrink-0 text-sun" /><div><p className="text-sm font-bold">{title as string}</p><p className="mt-1 text-xs leading-5 text-white/60">{detail as string}</p></div></div>; })}</div></section>
            <section className="rounded-3xl border border-border bg-card p-5"><p className="font-bold">{subject}难点地图</p><div className="mt-3 flex flex-wrap gap-2">{points.map((point) => <span key={point} className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold">{point}</span>)}</div><p className="mt-4 text-xs leading-5 text-muted-foreground">这是根据课程标准中的核心能力与常见综合任务归纳的复盘标签，不是官方难度排名。</p></section>
          </aside>
        </div>

        <section className="mt-6 rounded-3xl border border-border bg-card p-5 sm:p-7"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.13em] text-muted-foreground">历史错题</p><h2 className="mt-1 font-heading text-2xl font-bold">随时回来再看</h2></div><span className="inline-flex items-center gap-1 text-sm font-bold text-primary">共 {scans.length} 题 <ChevronRight className="size-4" /></span></div>{scans.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">还没有上传真实错题。第一道题会从这里开始积累。</div> : <div className="mt-5 grid gap-3 sm:grid-cols-2">{scans.map((item) => <article key={item.id} className="rounded-2xl border border-border p-4"><div className="flex items-center justify-between gap-2"><span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold">{item.subject}</span><span className="text-xs text-muted-foreground">{item.createdAt.slice(0, 10)}</span></div><h3 className="mt-3 font-bold">{item.originalName}</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">出处：{item.source}</p><div className="mt-3 flex items-center justify-between"><p className="text-xs font-bold text-primary">{item.status}</p><a href={item.fileUrl} target="_blank" rel="noreferrer" className="text-xs font-bold underline underline-offset-4">查看原题</a></div></article>)}</div>}</section>
      </div>
    </main>
  );
}
