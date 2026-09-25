'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { StudyAttempt, StudyLesson } from '@/lib/study';
import { studySource } from '@/lib/study';
import { StudyVisual } from './study-visuals';

export function StudyPlayer({
  lesson,
  review,
  onAnswer,
}: {
  lesson: StudyLesson;
  review: boolean;
  onAnswer: (attempt: StudyAttempt) => void;
}) {
  const [index, setIndex] = useState(review ? 3 : 0);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [hints, setHints] = useState(0);
  const [seenExplanation, setSeenExplanation] = useState(false);
  const [assistedQuestions, setAssistedQuestions] = useState<string[]>([]);
  const question = lesson.questions[index];
  const isReview = index === 3;
  function move(next: number) {
    setIndex(next);
    setSelected(null);
    setSubmitted(false);
    setHints(0);
  }
  function submit() {
    if (selected === null || submitted) return;
    onAnswer({
      lessonId: lesson.id,
      questionId: question.id,
      answer: question.options[selected],
      correct: selected === question.correct,
      assisted:
        seenExplanation || hints > 0 || assistedQuestions.includes(question.id),
      mode: isReview ? 'review' : 'practice',
      at: new Date().toISOString(),
    });
    setSubmitted(true);
    setAssistedQuestions((current) => [...new Set([...current, question.id])]);
  }
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <article className="min-w-0 rounded-2xl border bg-card p-5 sm:p-7">
        <p className="text-xs font-bold text-primary">
          {lesson.subject} · {lesson.chapter} · 约{lesson.minutes}分钟
        </p>
        <h2 className="mt-3 font-heading text-2xl font-bold">{lesson.title}</h2>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          目标：{lesson.objective}
        </p>
        <div className="mt-5 rounded-xl bg-secondary/50 p-4 text-sm leading-7">
          <strong>一句话先懂：</strong>
          {lesson.hook}
        </div>
        <details
          className="mt-4 rounded-xl border p-4"
          onToggle={(e) => {
            if (e.currentTarget.open) setSeenExplanation(true);
          }}
        >
          <summary className="cursor-pointer font-bold">
            需要时展开：{lesson.steps.length}步方法与例题
          </summary>
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-7">
            {lesson.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="mt-4 rounded-lg bg-muted p-4 text-sm leading-7">
            <p className="font-bold">例题：{lesson.example.prompt}</p>
            {lesson.example.steps.map((step) => (
              <p key={step}>{step}</p>
            ))}
          </div>
          <p className="mt-4 text-sm leading-7">
            <strong>避坑：</strong>
            {lesson.trap}
          </p>
        </details>
        <section className="mt-6 border-t pt-5" aria-label="针对练习">
          <div className="flex flex-wrap gap-2">
            {lesson.questions.map((q, i) => (
              <button
                key={q.id}
                type="button"
                aria-pressed={i === index}
                onClick={() => move(i)}
                className={`min-h-11 rounded-lg px-3 text-sm font-bold ${i === index ? 'bg-ink text-white' : 'bg-muted'}`}
              >
                {['先试一题', '同类再练', '换个条件', '隔时复习'][i]}
              </button>
            ))}
          </div>
          {isReview && (
            <p className="mt-3 text-xs leading-6 text-muted-foreground">
              这题留给之后复习更有价值。未到复习日也可练，但不会仅凭当天做对标记“隔时迁移通过”。
            </p>
          )}
          <h3 className="mt-5 text-lg font-bold leading-8">
            {question.prompt}
          </h3>
          <p className="mt-2 text-xs text-muted-foreground">
            先在纸上写出计算或依据，再选答案。第{index + 1}题 / 共4题
          </p>
          <fieldset className="mt-4 space-y-2" disabled={submitted}>
            <legend className="sr-only">选择答案</legend>
            {question.options.map((option, i) => (
              <label
                key={option}
                className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm leading-6 ${selected === i ? 'border-primary bg-secondary/50' : 'bg-background'}`}
              >
                <input
                  className="mt-1 size-4 shrink-0 accent-current"
                  type="radio"
                  name={`answer-${question.id}`}
                  value={i}
                  checked={selected === i}
                  onChange={() => setSelected(i)}
                />
                <span>
                  {String.fromCharCode(65 + i)}. {option}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              disabled={selected === null || submitted}
              onClick={submit}
              className="min-h-11 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-40"
            >
              检查答案
            </button>
            <button
              disabled={submitted || hints >= lesson.steps.length}
              onClick={() => setHints((n) => n + 1)}
              className="min-h-11 rounded-xl border px-4 text-sm font-bold disabled:opacity-40"
            >
              给我一点提示（{hints}/{lesson.steps.length}）
            </button>
          </div>
          {hints > 0 && (
            <ol className="mt-4 list-decimal space-y-2 rounded-xl bg-muted p-4 pl-9 text-sm leading-6">
              {lesson.steps.slice(0, hints).map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ol>
          )}
          {submitted && (
            <section
              aria-live="polite"
              aria-label="答题反馈"
              className="mt-5 rounded-xl border border-primary/30 bg-secondary/40 p-4 text-sm leading-7"
            >
              <p className="font-bold">
                {selected === question.correct
                  ? '做对了，再说一句为什么。'
                  : '这次没对，已尝试收录错题；看看关键一步。'}
              </p>
              <p className="mt-2">
                答案：{question.options[question.correct]}。
                {question.explanation}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                本次是否独立，按有没有展开方法、查看提示或本题解析记录；看懂后再练不冒充第一次独立完成。
              </p>
              {index < 2 && (
                <button
                  className="mt-3 min-h-11 font-bold underline underline-offset-4"
                  onClick={() => move(index + 1)}
                >
                  继续：{index === 0 ? '同类再练' : '换个条件'}
                </button>
              )}
            </section>
          )}
          <p className="mt-4 break-words text-xs leading-5 text-muted-foreground">
            出处：{studySource(lesson, question)}
          </p>
        </section>
      </article>
      <aside className="min-w-0 space-y-4">
        <StudyVisual kind={lesson.visual} />
        <section className="rounded-2xl bg-ink p-5 text-white">
          <h3 className="font-bold">爸爸的3分钟讲法</h3>
          <p className="mt-3 text-sm leading-7">
            先用上面的比喻，再挑一个数或一个位置演示。最后只问一句：
          </p>
          <p className="mt-3 rounded-lg border border-white/25 p-3 text-sm leading-7">
            {lesson.parentPrompt}
          </p>
          <p className="mt-3 text-xs leading-6 text-white/75">
            先听孩子解释，再给提示。会的题可以跳过，卡住就少做一点，不追求一次全懂。
          </p>
        </section>
        <section className="rounded-2xl border bg-card p-5">
          <h3 className="font-bold">纸上也能学</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            同一组题，一页作答；另选家长解析版。题号与错题本一致。
          </p>
          <Link
            href={`/${lesson.child}/practice/method-${lesson.id}`}
            className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-muted px-4 text-sm font-bold"
          >
            打开配套打印页
          </Link>
        </section>
        <details className="rounded-2xl border bg-card p-5 text-xs leading-6">
          <summary className="cursor-pointer font-bold">
            方法参考与原创说明
          </summary>
          <p className="mt-3">
            讲解、题目与图示由双宝平台原创编写；以下为概念或备课参考，不是题目出处。学校进度和课本章号以实物教材为准。
          </p>
          <a
            className="mt-2 block text-primary underline"
            href={lesson.reference.url}
            target="_blank"
            rel="noreferrer"
          >
            {lesson.reference.title}
          </a>
        </details>
      </aside>
    </div>
  );
}
