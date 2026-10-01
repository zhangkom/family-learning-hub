'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { WorkbenchHeader } from '@/app/components/workbench-header';
import {
  childLabel,
  currentFamily,
  listenLearning,
  readLocal,
} from '@/lib/family-client';
import { children, emptyFamily } from '@/lib/family-state';
import { studyLessons } from '@/lib/study-catalog';
import { getStudyStatus, studyDate } from '@/lib/study';

export default function FamilyReview() {
  const [records, setRecords] = useState(emptyFamily());
  const [loggedIn, setLoggedIn] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const read = () => {
      setRecords(readLocal());
      setLoggedIn(Boolean(currentFamily()));
      setNow(Date.now());
    };
    read();
    return listenLearning(read);
  }, []);
  const today = studyDate(new Date(now));
  const weekAgo = now - 7 * 24 * 3600000;
  return (
    <main className="min-h-screen">
      <WorkbenchHeader backHref="/" backLabel="家庭总览" />
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
        <header>
          <p className="text-sm font-bold text-primary">家长复盘</p>
          <h1 className="mt-2 text-3xl font-bold">下一次陪学，从哪里开始</h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            依据真实作答整理。提示后完成和独立完成分别记录，纸笔批改不自动计为独立掌握。
          </p>
          {!loggedIn && (
            <Link
              className="mt-3 inline-block text-sm underline"
              href="/account"
            >
              当前展示本机记录，登录后可汇总其他设备
            </Link>
          )}
        </header>
        {children.map((child) => {
          const s = records[child];
          const recent = s.attempts.filter((a) => Date.parse(a.at) >= weekAgo);
          const independent = recent.filter(
            (a) => a.correct && !a.assisted && a.origin !== 'paper',
          );
          const lessons = studyLessons
            .filter((l) => l.child === child)
            .map((l) => ({ ...l, state: getStudyStatus(s.attempts, l.id) }));
          const due = lessons.filter(
            (l) => l.state.dueOn && l.state.dueOn <= today,
          );
          const repeated = lessons.filter(
            (l) =>
              s.attempts.filter((a) => a.lessonId === l.id && !a.correct)
                .length >= 2,
          );
          return (
            <section key={child} className="rounded-2xl border bg-card p-5">
              <h2 className="text-xl font-bold">{childLabel(child)}</h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['近七天作答', recent.length],
                  ['独立答对', independent.length],
                  ['待复习方法', due.length],
                  ['保留错题', s.wrong.length],
                ].map(([label, count]) => (
                  <div key={label} className="rounded-xl bg-secondary/40 p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-2 text-2xl font-bold">{count}</p>
                  </div>
                ))}
              </div>
              <h3 className="mt-5 font-bold">到期复习</h3>
              {due.length ? (
                <ul className="mt-2 space-y-2">
                  {due.map((l) => (
                    <li key={l.id}>
                      <Link
                        className="text-sm underline"
                        href={`/${child}/study?lesson=${l.id}&review=1`}
                      >
                        {l.subject} · {l.title}（{l.state.dueOn}）
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  目前没有到期的方法课，选一个学校当前的卡点练习即可。
                </p>
              )}
              <h3 className="mt-5 font-bold">反复出错的方法</h3>
              {repeated.length ? (
                <ul className="mt-2 space-y-2">
                  {repeated.map((l) => (
                    <li key={l.id}>
                      <Link
                        className="text-sm underline"
                        href={`/${child}/study?lesson=${l.id}`}
                      >
                        {l.title} · {l.state.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  暂未发现同一方法下两次以上的错误。
                </p>
              )}
              <Link
                className="mt-5 inline-block text-sm font-bold text-primary"
                href={`/${child}/wrong-book`}
              >
                查看完整错题与作答历史 →
              </Link>
            </section>
          );
        })}
      </div>
    </main>
  );
}
