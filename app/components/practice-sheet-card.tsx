import Link from 'next/link';
import { CheckCircle2, ChevronRight, Clock3 } from 'lucide-react';
import type { LearningSubject } from '@/lib/learning';
import type { PracticeSheet } from '@/lib/practice';

const subjectTone: Record<LearningSubject, string> = {
  数学: 'subject-math',
  英语: 'subject-english',
  物理: 'subject-physics',
  化学: 'subject-chemistry',
  生物: 'subject-biology',
};

export function PracticeSheetCard({
  child,
  sheet,
  done,
}: {
  child: 'xiaobao' | 'dabao';
  sheet: PracticeSheet;
  done: boolean;
}) {
  return (
    <Link
      href={`/${child}/practice/${sheet.id}`}
      className="practice-card group relative overflow-hidden rounded-3xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg hover:shadow-primary/5 sm:p-6"
    >
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-secondary font-heading text-base font-bold text-primary">
          {String(sheet.sequence).padStart(2, '0')}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className={`text-xs font-bold ${subjectTone[sheet.subject]}`}>
              {sheet.stage}
              {sheet.subject}
            </p>
            {done && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-primary">
                <CheckCircle2 className="size-4" /> 已完成
              </span>
            )}
          </div>
          <h3 className="mt-2 font-heading text-xl font-bold">{sheet.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{sheet.subtitle}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {sheet.focus.slice(0, 3).map((focus) => (
              <span
                key={focus}
                className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
              >
                {focus}
              </span>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="size-3.5" /> {sheet.duration} 分钟 ·{' '}
              {sheet.questions.length} 题
            </span>
            <span className="inline-flex items-center gap-1 font-bold text-foreground">
              打开练习{' '}
              <ChevronRight className="size-4 transition group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
