'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarCheck2,
  Check,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  FlaskConical,
  HeartPulse,
  Lightbulb,
  RefreshCcw,
  School,
  Target,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress, ProgressLabel } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type ChildPlan = {
  id: 'dabao' | 'xiaobao';
  name: string;
  stage: string;
  graduation: string;
  target: string;
  targetNote: string;
  workbench: { label: string; href: string; description: string };
  accent: 'coral' | 'teal';
  tasks: { id: string; title: string; detail: string; minutes: number }[];
  subjects: { name: string; role: string; focus: string; routine: string; status: '主攻' | '稳住' | '习惯' | '专项' }[];
  roadmap: { term: string; title: string; outcome: string }[];
  policyTitle: string;
  policyFacts: string[];
  sources: { label: string; href: string }[];
};

const statusStyles = {
  主攻: 'bg-[#fff0e9] text-[#a64224]',
  稳住: 'bg-[#e7f5f2] text-[#176a62]',
  习惯: 'bg-[#eef2fb] text-[#3d5790]',
  专项: 'bg-[#fff7d9] text-[#82630c]',
};

export function ChildDashboard({ plan }: { plan: ChildPlan }) {
  const [checked, setChecked] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const storageKey = `twin-stars:${plan.id}:weekly-tasks`;

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    const timer = window.setTimeout(() => {
      if (saved) {
        try {
          setChecked(JSON.parse(saved));
        } catch {
          setChecked([]);
        }
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  const toggleTask = (taskId: string) => {
    setChecked((current) => {
      const next = current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId];
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  };

  const progress = useMemo(() => Math.round((checked.length / plan.tasks.length) * 100), [checked.length, plan.tasks.length]);

  return (
    <main className={`plan-page plan-page--${plan.accent} min-h-screen bg-background text-foreground`}>
      <header className="border-b border-border/80 bg-background/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> 家庭总览
          </Link>
          <p className="font-heading text-base font-bold">双宝名校计划</p>
          <span className="hidden text-xs text-muted-foreground sm:block">私人家庭学习空间</span>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-7 lg:px-8 lg:py-9">
        <section className="plan-banner grid gap-6 rounded-[1.75rem] p-6 md:grid-cols-[1fr_auto] md:items-end lg:p-8">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <span className="plan-dot" /> {plan.stage} · {plan.graduation}
            </div>
            <h1 className="font-heading text-3xl font-bold tracking-[-0.035em] sm:text-4xl">{plan.name}的成长页</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{plan.targetNote}</p>
          </div>
          <div className="min-w-60 rounded-2xl bg-white/75 p-4 backdrop-blur-sm">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.12em] text-muted-foreground">
              <Target className="size-4" /> 当前目标坐标
            </p>
            <p className="mt-2 font-heading text-xl font-bold">{plan.target}</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{plan.workbench.description}</p>
            <Link
              href={plan.workbench.href}
              className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 text-sm font-bold text-white transition hover:-translate-y-0.5"
            >
              {plan.workbench.label} <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>

        <Tabs defaultValue="week" className="mt-7">
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl border border-border bg-card p-1.5 sm:w-fit">
            <TabsTrigger value="week" className="min-h-9 px-3">本周执行</TabsTrigger>
            <TabsTrigger value="subjects" className="min-h-9 px-3">学科地图</TabsTrigger>
            <TabsTrigger value="roadmap" className="min-h-9 px-3">倒推路线</TabsTrigger>
            <TabsTrigger value="rules" className="min-h-9 px-3">考试规则</TabsTrigger>
          </TabsList>

          <TabsContent value="week" className="mt-5">
            <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
              <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[.13em] text-muted-foreground">本周三件关键事</p>
                    <h2 className="mt-1 font-heading text-2xl font-bold">做少一点，闭环多一点</h2>
                  </div>
                  <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold">共 {plan.tasks.reduce((sum, item) => sum + item.minutes, 0)} 分钟</span>
                </div>

                <Progress value={ready ? progress : 0} className="mt-6">
                  <ProgressLabel>完成度</ProgressLabel>
                  <span className="ml-auto text-sm tabular-nums text-muted-foreground">{ready ? progress : 0}%</span>
                </Progress>

                <div className="mt-6 space-y-3">
                  {plan.tasks.map((task) => {
                    const done = checked.includes(task.id);
                    return (
                      <label key={task.id} className={`group flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${done ? 'border-primary/20 bg-secondary/55' : 'border-border bg-background hover:border-primary/25'}`}>
                        <Checkbox checked={done} onCheckedChange={() => toggleTask(task.id)} aria-label={`完成：${task.title}`} className="mt-1" />
                        <span className="min-w-0 flex-1">
                          <span className={`block font-semibold ${done ? 'text-muted-foreground line-through' : ''}`}>{task.title}</span>
                          <span className="mt-1 block text-sm leading-6 text-muted-foreground">{task.detail}</span>
                        </span>
                        <span className="shrink-0 rounded-full bg-card px-2 py-1 text-xs text-muted-foreground">{task.minutes} 分钟</span>
                      </label>
                    );
                  })}
                </div>
              </section>

              <aside className="space-y-5">
                <div className="rounded-3xl bg-ink p-5 text-white">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-white/55">
                    <RefreshCcw className="size-4" /> 一道错题的生命周期
                  </p>
                  <ol className="mt-4 space-y-3 text-sm">
                    {['当天：写清错因，不抄整题', '第 2 天：遮住答案重做', '第 7 天：做一道同类变式', '第 30 天：随机抽检一次'].map((item, index) => (
                      <li key={item} className="flex gap-3">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/10 text-xs text-sun">{index + 1}</span>
                        <span className="pt-0.5 text-white/85">{item}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="rounded-3xl border border-border bg-card p-5">
                  <p className="flex items-center gap-2 font-bold"><Lightbulb className="size-5 text-primary" /> 题库怎么用</p>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    每周按错因生成 2–3 组“小题包”，每组 5–8 题。正确率连续两次达到 85% 再升级，不以刷题数量作为目标。
                  </p>
                </div>
              </aside>
            </div>
          </TabsContent>

          <TabsContent value="subjects" className="mt-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plan.subjects.map((subject) => (
                <article key={subject.name} className="rounded-3xl border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid size-10 place-items-center rounded-2xl bg-muted"><BookOpen className="size-5 text-primary" /></div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[subject.status]}`}>{subject.status}</span>
                  </div>
                  <h3 className="mt-4 font-heading text-xl font-bold">{subject.name}</h3>
                  <p className="mt-1 text-xs font-semibold text-primary">{subject.role}</p>
                  <p className="mt-4 text-sm leading-6 text-muted-foreground">{subject.focus}</p>
                  <div className="mt-4 border-t border-border pt-4 text-sm">
                    <span className="font-semibold">固定动作：</span>{subject.routine}
                  </div>
                </article>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="roadmap" className="mt-5">
            <section className="rounded-3xl border border-border bg-card p-5 sm:p-7">
              <div className="mb-6 flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-2xl bg-secondary text-primary"><CalendarCheck2 className="size-5" /></div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[.13em] text-muted-foreground">从毕业倒推到本周</p>
                  <h2 className="font-heading text-2xl font-bold">阶段里程碑</h2>
                </div>
              </div>
              <div className="relative space-y-1 before:absolute before:bottom-5 before:left-[15px] before:top-5 before:w-px before:bg-border">
                {plan.roadmap.map((step, index) => (
                  <div key={step.term} className="relative grid grid-cols-[32px_1fr] gap-4 py-3">
                    <span className="z-10 grid size-8 place-items-center rounded-full border-4 border-card bg-primary text-xs font-bold text-primary-foreground">{index + 1}</span>
                    <div className="rounded-2xl bg-muted/70 p-4">
                      <p className="text-xs font-semibold text-primary">{step.term}</p>
                      <h3 className="mt-1 font-bold">{step.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">完成标志：{step.outcome}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="rules" className="mt-5">
            <div className="grid gap-5 lg:grid-cols-[1fr_.65fr]">
              <section className="rounded-3xl border border-border bg-card p-5 sm:p-7">
                <p className="flex items-center gap-2 text-sm font-semibold text-primary"><School className="size-4" /> 官方口径摘要</p>
                <h2 className="mt-2 font-heading text-2xl font-bold">{plan.policyTitle}</h2>
                <div className="mt-5 space-y-3">
                  {plan.policyFacts.map((fact) => (
                    <div key={fact} className="flex gap-3 rounded-2xl bg-muted/70 p-4 text-sm leading-6">
                      <Check className="mt-1 size-4 shrink-0 text-primary" />
                      <span>{fact}</span>
                    </div>
                  ))}
                </div>
              </section>
              <aside className="rounded-3xl border border-border bg-card p-5">
                <p className="flex items-center gap-2 font-bold"><CircleAlert className="size-5 text-primary" /> 使用提醒</p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  政策、招生专业组和投档位次会变化。网页中的数字是倒推坐标，不是录取承诺；每年 7–9 月用最新官方数据刷新一次。
                </p>
                <div className="mt-5 space-y-2">
                  {plan.sources.map((source) => (
                    <a key={source.href} href={source.href} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl border border-border px-3 py-3 text-sm font-semibold hover:border-primary/30 hover:bg-muted/60">
                      {source.label}<ExternalLink className="size-4 text-muted-foreground" />
                    </a>
                  ))}
                </div>
              </aside>
            </div>
          </TabsContent>
        </Tabs>

        <section className="mt-7 grid gap-4 sm:grid-cols-3">
          {[
            [FlaskConical, '练习量', '以掌握率为准，不追求堆题'],
            [HeartPulse, '身心底线', '睡眠、运动、情绪都要记分'],
            [ChevronRight, '家长角色', '问“哪里卡住”，少问“考了几分”'],
          ].map(([Icon, title, detail]) => {
            const CardIcon = Icon as typeof Target;
            return (
              <div key={title as string} className="flex gap-3 rounded-2xl border border-border bg-card p-4">
                <CardIcon className="mt-0.5 size-5 shrink-0 text-primary" />
                <div><p className="font-bold">{title as string}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail as string}</p></div>
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}
