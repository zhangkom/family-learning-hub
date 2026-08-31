'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  BookOpenCheck,
  CheckCircle2,
  Layers3,
  LockKeyhole,
  Printer,
  Target,
} from 'lucide-react';
import { WorkbenchHeader } from '@/app/components/workbench-header';
import { PracticeSheetCard } from '@/app/components/practice-sheet-card';
import { parseStoredStringList, type LearningSubject } from '@/lib/learning';
import type { PracticeSheet } from '@/lib/practice';

type SubjectStatus = { name: LearningSubject; note: string; active: boolean };

export function PracticeHub({
  child,
  backHref,
  backLabel,
  eyebrow,
  title,
  description,
  cadence,
  sheets,
  subjects,
  sourceLinks,
  wrongBookHref,
}: {
  child: 'xiaobao' | 'dabao';
  backHref: string;
  backLabel: string;
  eyebrow: string;
  title: string;
  description: string;
  cadence: string;
  sheets: PracticeSheet[];
  subjects: SubjectStatus[];
  sourceLinks: { label: string; href: string }[];
  wrongBookHref: string;
}) {
  const [completed, setCompleted] = useState<string[]>([]);
  const storageKey = `twin-stars:${child}:practice-complete`;

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    const timer = window.setTimeout(() => {
      if (saved) {
        setCompleted(parseStoredStringList(saved));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  const progress = useMemo(
    () =>
      Math.round(
        (completed.filter((id) => sheets.some((sheet) => sheet.id === id))
          .length /
          sheets.length) *
          100,
      ),
    [completed, sheets],
  );

  return (
    <main
      className={`practice-page practice-page--${child} min-h-screen bg-background text-foreground`}
    >
      <WorkbenchHeader backHref={backHref} backLabel={backLabel} />
      <div className="mx-auto max-w-7xl px-5 py-8 lg:px-8 lg:py-10">
        <section className="practice-intro grid gap-8 rounded-[1.75rem] border border-border p-6 lg:grid-cols-[1fr_20rem] lg:p-9">
          <div>
            <p className="text-sm font-bold text-primary">{eyebrow}</p>
            <h1 className="mt-3 max-w-3xl font-heading text-3xl font-bold tracking-[-0.035em] sm:text-4xl">
              {title}
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground sm:text-base">
              {description}
            </p>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-sm">
              <span className="inline-flex items-center gap-2">
                <Printer className="size-4 text-primary" /> A4 一页一练
              </span>
              <span className="inline-flex items-center gap-2">
                <Target className="size-4 text-primary" /> 每题有知识标签
              </span>
              <span className="inline-flex items-center gap-2">
                <BookOpenCheck className="size-4 text-primary" />{' '}
                批改后进入错题复习
              </span>
            </div>
          </div>
          <aside className="rounded-2xl bg-ink p-5 text-white">
            <p className="text-xs font-semibold uppercase tracking-[.13em] text-white/55">
              建议节奏
            </p>
            <p className="mt-3 text-lg font-bold leading-7">{cadence}</p>
            <div className="mt-6">
              <div className="flex items-center justify-between text-xs text-white/65">
                <span>当前完成</span>
                <span>{progress}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-sun transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <Link
              href={wrongBookHref}
              className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-white underline decoration-white/30 underline-offset-4"
            >
              查看历史错题 <BookOpenCheck className="size-4" />
            </Link>
          </aside>
        </section>

        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">
                训练路径
              </p>
              <h2 className="mt-1 font-heading text-2xl font-bold">
                按顺序完成，不跳着刷
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              先独立限时完成，再由家长对照讲解批改；不会的题只勾入错题本，不在原卷抄答案。
            </p>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {sheets.map((sheet) => (
              <PracticeSheetCard
                key={sheet.id}
                child={child}
                sheet={sheet}
                done={completed.includes(sheet.id)}
              />
            ))}
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-border bg-card p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <Layers3 className="size-5 text-primary" />
            <div>
              <h2 className="font-bold">学科路线</h2>
              <p className="text-xs text-muted-foreground">
                只展示当前真正可用的内容，后续按同一标准逐科开放。
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {subjects.map((subject) => (
              <div
                key={subject.name}
                className={`rounded-2xl border p-4 ${subject.active ? 'border-primary/25 bg-secondary/35' : 'border-border bg-muted/35 text-muted-foreground'}`}
              >
                <div className="flex items-center justify-between">
                  <p className="font-bold">{subject.name}</p>
                  {subject.active ? (
                    <CheckCircle2 className="size-4 text-primary" />
                  ) : (
                    <LockKeyhole className="size-4" />
                  )}
                </div>
                <p className="mt-2 text-xs leading-5">{subject.note}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-5 grid gap-4 rounded-2xl border border-border bg-card p-5 text-sm lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="font-bold">课程版本与原创说明</p>
            <p className="mt-1 leading-6 text-muted-foreground">
              {sheets[0].edition}
              。训练题依据课程标准和公开教材目录重新命制，不复刻商业教辅；学校实际教学顺序不同时，以孩子课本目录为准调整。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {sourceLinks.map((source) => (
              <a
                key={source.href}
                href={source.href}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-border px-3 py-2 text-xs font-bold hover:border-primary/30 hover:bg-muted"
              >
                {source.label}
              </a>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
