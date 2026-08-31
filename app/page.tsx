import Link from 'next/link';
import {
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  Flag,
  RefreshCcw,
  Sparkles,
  Target,
} from 'lucide-react';

const children = [
  {
    name: '大宝',
    stage: '高中二年级',
    route: '/dabao',
    accent: 'coral',
    horizon: '预计 2028 高考',
    focus: '先定选科与专业方向，再用年级/省排位倒推',
    thisWeek: ['完成一次全科成绩盘点', '建立数学、物理错因标签', '周日做 30 分钟家庭复盘'],
  },
  {
    name: '小宝',
    stage: '初中一年级',
    route: '/xiaobao',
    accent: 'teal',
    horizon: '预计 2029 中考',
    focus: '先养成学习闭环，兼顾理化实验、体育和英语听说',
    thisWeek: ['整理语数英课堂遗留问题', '选定体育长期项目', '周末完成一次错题重做'],
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/80 bg-background/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="size-5" />
            </div>
            <div>
              <p className="font-heading text-lg font-bold tracking-tight">双宝名校计划</p>
              <p className="text-xs text-muted-foreground">两个孩子 · 两条路径 · 一个家庭学习节奏</p>
            </div>
          </div>
          <span className="hidden rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground sm:inline-flex">
            初版方案 · 2026 秋
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-8 lg:px-8 lg:py-10">
        <section className="grid gap-6 lg:grid-cols-[1.45fr_.75fr]">
          <div>
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
              <Target className="size-4" /> 家庭总目标
            </p>
            <h1 className="max-w-3xl font-heading text-3xl font-bold leading-tight tracking-[-0.035em] sm:text-4xl">
              大宝逐梦名校，小宝冲刺深圳四大——双宝并肩，未来一路向上。
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-muted-foreground">
              这里记录两个孩子各自的成长路线：大宝聚焦高二物化生，向理想名校稳步迈进；小宝夯实初中基础，向深圳四大高中发起冲刺。
              目标不同，节奏不同，但每一次认真学习都在为更辽阔的未来积蓄力量。
            </p>
          </div>

          <aside className="rounded-3xl border border-border bg-card p-5 shadow-[0_14px_44px_-30px_rgba(24,39,75,.35)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">本周家庭共学</p>
                <p className="mt-1 font-heading text-xl font-bold">周日 20:30 · 30 分钟</p>
              </div>
              <CalendarDays className="size-6 text-primary" />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
              {['看数据', '找主因', '定三件事'].map((item, index) => (
                <div key={item} className="rounded-2xl bg-muted px-2 py-3">
                  <span className="mb-1 block font-heading text-lg font-bold text-primary">0{index + 1}</span>
                  {item}
                </div>
              ))}
            </div>
          </aside>
        </section>

        <section className="mt-9 grid gap-5 md:grid-cols-2">
          {children.map((child) => (
            <article key={child.name} className={`child-card child-card--${child.accent}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <span className="child-dot" />
                    <span className="text-sm font-semibold">{child.stage}</span>
                  </div>
                  <h2 className="font-heading text-2xl font-bold">{child.name}的成长页</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{child.horizon}</p>
                </div>
                <Flag className="size-6 text-muted-foreground" />
              </div>
              <p className="mt-5 rounded-2xl bg-background/70 p-4 text-sm leading-6">{child.focus}</p>
              <div className="mt-5 space-y-2.5">
                {child.thisWeek.map((item) => (
                  <div key={item} className="flex items-center gap-2.5 text-sm">
                    <CheckCircle2 className="size-4 text-muted-foreground/70" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <Link href={child.route} className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-foreground hover:text-primary">
                打开{child.name}专属页 <ArrowRight className="size-4" />
              </Link>
            </article>
          ))}
        </section>

        <section className="mt-8 rounded-3xl bg-ink px-5 py-6 text-white sm:px-7">
          <div className="grid gap-6 lg:grid-cols-[.8fr_2fr] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/55">共同学习闭环</p>
              <h2 className="mt-2 font-heading text-2xl font-bold">不是“刷过”，是“学会”</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                [Target, '目标', '月度拆解'],
                [BookOpenCheck, '练习', '少而精准'],
                [RefreshCcw, '错题', '隔天回炉'],
                [CheckCircle2, '复盘', '周周调整'],
              ].map(([Icon, title, caption]) => {
                const StepIcon = Icon as typeof Target;
                return (
                  <div key={title as string} className="rounded-2xl bg-white/8 p-4">
                    <StepIcon className="size-5 text-sun" />
                    <p className="mt-3 font-bold">{title as string}</p>
                    <p className="mt-0.5 text-xs text-white/55">{caption as string}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
