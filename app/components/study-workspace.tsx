'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { WorkbenchHeader } from './workbench-header';
import { StudyPlayer } from './study-player';
import { studyLessons } from '@/lib/study-catalog';
import {
  getStudyStatus,
  parseStudyAttempts,
  recordStudyAttempt,
  studyDate,
  studySource,
  type StudyAttempt,
} from '@/lib/study';
import { createWrongQuestion, parseStoredWrongQuestions } from '@/lib/learning';

export function StudyWorkspace({ child }: { child: 'xiaobao' | 'dabao' }) {
  const lessons = studyLessons.filter((item) => item.child === child);
  const [lessonId, setLessonId] = useState(lessons[0].id);
  const [week, setWeek] = useState(1);
  const [review, setReview] = useState(false);
  const [attempts, setAttempts] = useState<StudyAttempt[]>([]);
  const [notice, setNotice] = useState('正在读取当前浏览器的学习记录…');
  const [ready, setReady] = useState(false);
  const [today, setToday] = useState('');
  const attemptKey = `twin-stars:${child}:study-attempts`;
  const wrongKey = `twin-stars:${child}:wrong-questions`;
  const lesson = lessons.find((item) => item.id === lessonId) ?? lessons[0];
  const status = getStudyStatus(attempts, lesson.id);
  const due = lessons.filter((item) => {
    const state = getStudyStatus(attempts, item.id);
    return state.dueOn && today && state.dueOn <= today;
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let history: StudyAttempt[] = [];
      try {
        history = parseStudyAttempts(window.localStorage.getItem(attemptKey));
        setNotice('记录保存在当前浏览器；换设备不会自动同步。');
      } catch {
        setNotice('浏览器存储不可用，仍可练习，但本次记录不会长期保存。');
      }
      setAttempts(history);
      setToday(studyDate());
      const query = new URLSearchParams(window.location.search);
      const available = studyLessons.filter((item) => item.child === child);
      const requested = available.find(
        (item) => item.id === query.get('lesson'),
      );
      const overdue = available.find((item) => {
        const state = getStudyStatus(history, item.id);
        return state.dueOn && state.dueOn <= studyDate();
      });
      const initial = requested ?? overdue ?? available[0];
      setLessonId(initial.id);
      setWeek(initial.week);
      setReview(requested ? query.get('review') === '1' : Boolean(overdue));
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [child, attemptKey]);

  function choose(id: string, asReview = false) {
    const next = lessons.find((item) => item.id === id);
    if (!next) return;
    setLessonId(id);
    setWeek(next.week);
    setReview(asReview);
    const url = new URL(window.location.href);
    url.searchParams.set('lesson', id);
    if (asReview) url.searchParams.set('review', '1');
    else url.searchParams.delete('review');
    window.history.replaceState(null, '', url);
  }

  function saveAnswer(attempt: StudyAttempt) {
    const question = lesson.questions.find((q) => q.id === attempt.questionId);
    if (!question) return;
    try {
      const latest = parseStudyAttempts(
        window.localStorage.getItem(attemptKey),
      );
      const wrongQuestions = parseStoredWrongQuestions(
        window.localStorage.getItem(wrongKey),
      );
      const result = recordStudyAttempt(
        latest,
        wrongQuestions,
        attempt,
        createWrongQuestion({
          questionId: question.id,
          subject: lesson.subject,
          knowledgePoint: lesson.title,
          prompt: question.prompt,
          answer: `${question.options[question.correct]}。${question.explanation}`,
          learnerAnswer: attempt.answer,
          source: studySource(lesson, question),
        }),
      );
      window.localStorage.setItem(
        wrongKey,
        JSON.stringify(result.wrongQuestions),
      );
      window.localStorage.setItem(attemptKey, JSON.stringify(result.attempts));
      setAttempts(result.attempts);
      setNotice(
        attempt.correct
          ? '作答已保存在当前浏览器；讲清理由比猜中答案重要。'
          : '已保留这道题的首次错误；后续作答另记历史，不覆盖原答案。',
      );
    } catch {
      setAttempts((current) => [...current, attempt]);
      setNotice(
        '保存失败：浏览器空间不足或禁用了存储。仍可继续练习，请勿把本次结果当作已保存。',
      );
    }
  }

  return (
    <main
      className={`plan-page plan-page--${child === 'xiaobao' ? 'teal' : 'coral'} min-h-screen bg-background text-foreground`}
    >
      <WorkbenchHeader
        backHref={`/${child}`}
        backLabel={child === 'xiaobao' ? '小宝成长页' : '大宝成长页'}
      />
      <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8">
        <header className="plan-banner rounded-2xl p-5 sm:p-7">
          <p className="text-sm font-bold text-primary">
            {child === 'xiaobao'
              ? '小宝 · 数学 / 英语 / 地理'
              : '大宝 · 数学 / 物理 / 化学 / 生物'}
          </p>
          <h1 className="mt-2 font-heading text-3xl font-bold">
            {child === 'xiaobao'
              ? '一个难点，慢慢变成拿手题'
              : '周末练透一个方法'}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
            {child === 'xiaobao'
              ? '四周小计划 · 20张方法卡。优先补绝对值与经纬度；每天选一张，约15分钟。复习可替代新课，不补打卡债。'
              : '8张核心方法卡。每周挑本周真正卡住的两个点，结合校内错题复盘；按学校进度选，不必按表硬赶。'}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link className="study-link" href={`/${child}/practice`}>
              打印强化训练
            </Link>
            <Link className="study-link" href={`/${child}/wrong-book`}>
              错题与作答历史
            </Link>
          </div>
        </header>
        <section
          className="mt-5 rounded-2xl border bg-card p-4 sm:p-5"
          aria-label="四周学习目录"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold">四周内容目录</h2>
            <p className="text-xs text-muted-foreground">
              这是学习顺序，不是学校统一章号；会的可跳过。
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setWeek(n)}
                aria-pressed={week === n}
                className={`min-h-11 rounded-lg px-4 text-sm font-bold ${week === n ? 'bg-ink text-white' : 'bg-muted'}`}
              >
                第{n}周
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {lessons
              .filter((item) => item.week === week)
              .map((item) => (
                <button
                  key={item.id}
                  onClick={() => choose(item.id)}
                  aria-pressed={item.id === lesson.id}
                  className={`rounded-xl border p-3 text-left ${item.id === lesson.id ? 'border-primary bg-secondary/40' : 'hover:bg-muted'}`}
                >
                  <span className="text-xs text-primary">
                    {item.subject} · {getStudyStatus(attempts, item.id).label}
                  </span>
                  <span className="mt-1 block text-sm font-bold leading-6">
                    {item.title}
                  </span>
                </button>
              ))}
          </div>
        </section>
        {due.length > 0 && (
          <section className="mt-4 rounded-xl border border-primary/30 bg-secondary/40 p-4">
            <h2 className="text-sm font-bold">
              今天可以回头检查（{due.length}个点）
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {due.map((item) => (
                <button
                  key={item.id}
                  onClick={() => choose(item.id, true)}
                  className="min-h-11 rounded-lg border bg-card px-3 text-sm"
                >
                  复习：{item.title}
                </button>
              ))}
            </div>
          </section>
        )}
        <div className="my-4 flex flex-wrap items-center justify-between gap-2 text-xs leading-6 text-muted-foreground">
          <output>{notice}</output>
          <p>
            {status.label}
            {status.dueOn
              ? ` · 建议复习 ${status.dueOn}`
              : ' · 先做一题看卡在哪里'}
          </p>
        </div>
        {ready ? (
          <StudyPlayer
            key={`${lesson.id}-${review}`}
            lesson={lesson}
            review={review}
            onAnswer={saveAnswer}
          />
        ) : (
          <p className="rounded-2xl border bg-card p-8" aria-live="polite">
            正在准备小课…
          </p>
        )}
        <p className="mt-5 text-xs leading-6 text-muted-foreground">
          掌握状态依据实际作答：两道不同题独立答对后记“独立完成”，之后到期做对复习题才记“隔时迁移通过”。查看提示会单独记录。间隔为可调整的家庭练习规则，不是测评诊断。
        </p>
      </div>
    </main>
  );
}
