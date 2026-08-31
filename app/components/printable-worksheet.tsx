'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileCheck2,
  Lightbulb,
  Printer,
  RotateCcw,
} from 'lucide-react';
import { WorksheetPaper } from '@/app/components/worksheet-paper';
import {
  markPracticeComplete,
  mergePracticeWrongQuestions,
  type PracticeSheet,
} from '@/lib/practice';
import {
  parseStoredStringList,
  parseStoredWrongQuestions,
} from '@/lib/learning';

export function PrintableWorksheet({
  sheet,
  hubHref,
  previousHref,
  nextHref,
}: {
  sheet: PracticeSheet;
  hubHref: string;
  previousHref?: string;
  nextHref?: string;
}) {
  const [wrongIds, setWrongIds] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const storageKey = `twin-stars:${sheet.child}:wrong-questions`;
  const completionKey = `twin-stars:${sheet.child}:practice-complete`;
  const selectedCount = wrongIds.length;

  const toggleWrong = (id: string) => {
    setSaved(false);
    setWrongIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  const saveReview = () => {
    const current = parseStoredWrongQuestions(
      window.localStorage.getItem(storageKey),
    );
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(mergePracticeWrongQuestions(current, sheet, wrongIds)),
    );

    const completed = parseStoredStringList(
      window.localStorage.getItem(completionKey),
    );
    window.localStorage.setItem(
      completionKey,
      JSON.stringify(markPracticeComplete(completed, sheet.id)),
    );
    setSaved(true);
  };

  return (
    <main className="worksheet-shell min-h-screen bg-muted/55 px-3 py-5 text-foreground sm:px-6 lg:py-8">
      <nav className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3">
        <Link
          href={hubHref}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-bold"
        >
          <ArrowLeft className="size-4" /> 返回训练目录
        </Link>
        <div className="flex flex-wrap gap-2">
          {previousHref && (
            <Link
              href={previousHref}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-semibold"
            >
              <ArrowLeft className="size-4" /> 上一页
            </Link>
          )}
          {nextHref && (
            <Link
              href={nextHref}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-semibold"
            >
              下一页 <ArrowRight className="size-4" />
            </Link>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-bold text-white"
          >
            <Printer className="size-4" /> 打印 A4
          </button>
        </div>
      </nav>

      <WorksheetPaper sheet={sheet} />

      <section className="no-print mx-auto mt-5 max-w-[210mm] rounded-3xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 font-heading text-xl font-bold">
              <FileCheck2 className="size-5 text-primary" /> 家长批改台
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              展开答案逐题核对；只勾真正不会或思路不完整的题，进入第 2、7、30
              天复习。
            </p>
          </div>
          <span className="rounded-lg bg-muted px-3 py-2 text-xs font-bold">
            已选 {selectedCount} 道错题
          </span>
        </div>

        <details className="mt-5 rounded-2xl border border-border bg-background">
          <summary className="cursor-pointer px-4 py-4 font-bold">
            查看答案与一对一讲解要点
          </summary>
          <div className="border-t border-border p-4">
            <ol className="space-y-4">
              {sheet.questions.map((question, index) => (
                <li
                  key={question.id}
                  className="grid gap-3 rounded-2xl bg-muted/55 p-4 sm:grid-cols-[auto_1fr]"
                >
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-destructive">
                    <input
                      type="checkbox"
                      checked={wrongIds.includes(question.id)}
                      onChange={() => toggleWrong(question.id)}
                      className="size-4 accent-current"
                    />{' '}
                    错题
                  </label>
                  <div>
                    <p className="font-bold">
                      {index + 1}. {question.answer}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {question.explanation}
                    </p>
                    <p className="mt-2 text-xs text-primary">
                      知识点：{question.knowledgePoint} · 出处：
                      {question.source}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </details>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveReview}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground"
          >
            <RotateCcw className="size-4" /> 保存批改与错题
          </button>
          {saved && (
            <p className="inline-flex items-center gap-2 text-sm font-bold text-primary">
              <Check className="size-4" /> 已保存；本页标记为完成
            </p>
          )}
          {!saved && selectedCount === 0 && (
            <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Lightbulb className="size-4" />{' '}
              全对也要点击保存，记录本页完成状态。
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
