'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  BookOpenCheck,
  CalendarClock,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';
import { WorkbenchHeader } from '@/app/components/workbench-header';
import {
  parseStoredWrongQuestions,
  type LearningSubject,
  type WrongQuestion,
} from '@/lib/learning';
import { lessonForQuestion } from '@/lib/study-catalog';
import {
  getStudyStatus,
  parseStudyAttempts,
  type StudyAttempt,
} from '@/lib/study';

export function WrongQuestionBook({
  child,
  backHref,
  backLabel,
  practiceHref,
}: {
  child: 'xiaobao' | 'dabao';
  backHref: string;
  backLabel: string;
  practiceHref: string;
}) {
  const [items, setItems] = useState<WrongQuestion[]>([]);
  const [attempts, setAttempts] = useState<StudyAttempt[]>([]);
  const [loadError, setLoadError] = useState('');
  const [subject, setSubject] = useState<LearningSubject | '全部'>('全部');
  const storageKey = `twin-stars:${child}:wrong-questions`;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(storageKey);
        setAttempts(
          parseStudyAttempts(
            window.localStorage.getItem(`twin-stars:${child}:study-attempts`),
          ),
        );
        if (!saved) return;
        setItems(parseStoredWrongQuestions(saved));
      } catch {
        setLoadError('无法读取浏览器记录，请检查存储权限。记录未被删除。');
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey, child]);

  const subjects = useMemo(
    () => Array.from(new Set(items.map((item) => item.subject))),
    [items],
  );
  const visibleItems =
    subject === '全部'
      ? items
      : items.filter((item) => item.subject === subject);

  return (
    <main
      className={`practice-page practice-page--${child} min-h-screen bg-background text-foreground`}
    >
      <WorkbenchHeader backHref={backHref} backLabel={backLabel} />
      <div className="mx-auto max-w-5xl px-5 py-8 lg:px-8 lg:py-10">
        <section className="practice-intro rounded-[1.75rem] border border-border p-6 sm:p-8">
          <p className="text-sm font-bold text-primary">
            错题档案 · 保留原题与后续作答
          </p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-5">
            <div>
              <h1 className="font-heading text-3xl font-bold tracking-[-0.035em] sm:text-4xl">
                把“不会”变成会迁移
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
                这里保留原题、当时的作答、正确答案、知识点和出处。复习时先遮住答案独立重做，再尝试讲清关键转折。
              </p>
            </div>
            <Link
              href={practiceHref}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink px-5 text-sm font-bold text-white"
            >
              继续强化训练 <ChevronRight className="size-4" />
            </Link>
          </div>
        </section>

        <section className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            {(['全部', ...subjects] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setSubject(item)}
                className={`min-h-9 rounded-lg px-3 text-sm font-bold ${subject === item ? 'bg-primary text-primary-foreground' : 'border border-border bg-card'}`}
              >
                {item}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            当前 {visibleItems.length} 道
          </p>
        </section>

        {loadError && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {loadError}
          </p>
        )}
        {visibleItems.length === 0 ? (
          <section className="mt-5 grid min-h-64 place-items-center rounded-3xl border border-dashed border-border bg-card p-8 text-center">
            <div>
              <Archive className="mx-auto size-9 text-muted-foreground" />
              <h2 className="mt-4 font-heading text-xl font-bold">
                这里还没有错题
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                在线练习答错，或在家长批改台勾选错题并保存后，会出现在这里。记录仅保存在当前浏览器。
              </p>
            </div>
          </section>
        ) : (
          <div className="mt-5 space-y-4">
            {visibleItems.map((item, index) => {
              const lesson = lessonForQuestion(item.questionId);
              const progress = lesson
                ? getStudyStatus(attempts, lesson.id)
                : undefined;
              const history = attempts.filter(
                (a) => a.questionId === item.questionId,
              );
              return (
                <article
                  key={item.id}
                  className="rounded-3xl border border-border bg-card p-5 sm:p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-primary">
                        {item.subject} · {item.knowledgePoint}
                      </p>
                      <h2 className="mt-2 font-heading text-lg font-bold">
                        错题 {String(index + 1).padStart(2, '0')}
                      </h2>
                    </div>
                    <span className="rounded-lg bg-[#fff0e9] px-3 py-1.5 text-xs font-bold text-[#8e3a22]">
                      {progress?.attempts ? progress.label : item.status}
                    </span>
                  </div>
                  <p className="mt-4 rounded-2xl bg-muted/55 p-4 text-sm font-semibold leading-7">
                    {item.prompt}
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-border p-4">
                      <p className="text-xs font-bold text-muted-foreground">
                        当时作答
                      </p>
                      <p className="mt-2 text-sm leading-6">
                        {item.learnerAnswer}
                      </p>
                    </div>
                    <details className="rounded-2xl border border-primary/20 bg-secondary/25 p-4">
                      <summary className="cursor-pointer text-xs font-bold text-primary">
                        展开正确答案
                      </summary>
                      <p className="mt-2 text-sm font-semibold leading-6">
                        {item.answer}
                      </p>
                    </details>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <BookOpenCheck className="size-3.5" /> 出处：{item.source}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock className="size-3.5" />{' '}
                      {progress?.dueOn ? '下次建议：' : '初始复习建议：'}
                      {progress?.dueOn ?? item.reviewDates.join(' / ')}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <RotateCcw className="size-3.5" /> 收录：
                      {item.createdOn.slice(0, 10)}
                    </span>
                  </div>
                  {lesson && (
                    <div className="mt-4 border-t pt-4">
                      <Link
                        className="study-link"
                        href={`/${child}/study?lesson=${lesson.id}&review=1`}
                      >
                        回到方法课与复习题
                      </Link>
                      <details className="mt-3 text-sm">
                        <summary className="cursor-pointer font-bold">
                          查看本题作答历史（{history.length}次）
                        </summary>
                        <ol className="mt-3 space-y-2">
                          {history.map((a, i) => (
                            <li
                              key={`${a.at}-${i}`}
                              className="rounded-lg bg-muted p-3 text-xs leading-6"
                            >
                              {new Date(a.at).toLocaleString('zh-CN', {
                                timeZone: 'Asia/Shanghai',
                              })}{' '}
                              · {a.correct ? '答对' : '答错'} ·{' '}
                              {a.origin === 'paper'
                                ? '纸笔复盘（提示情况未核实）'
                                : a.assisted
                                  ? '使用过提示/解析'
                                  : '未使用提示'}
                              <br />
                              当时作答：{a.answer}
                            </li>
                          ))}
                        </ol>
                      </details>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
