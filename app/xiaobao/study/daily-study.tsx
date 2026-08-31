'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, Brain, Check, ChevronRight, Clock3, Lightbulb, RotateCcw, Sparkles } from 'lucide-react';
import { WorkbenchHeader } from '@/app/components/workbench-header';
import { createWrongQuestion, evaluateAnswer, type AnswerKind, type WrongQuestion } from '@/lib/learning';

type Exercise = { id: string; prompt: string; accepted: string[]; source: string };
type Lesson = {
  subject: '数学' | '英语';
  focus: string;
  objective: string;
  explanation: string;
  tip: string;
  kind: AnswerKind;
  exercise: Exercise;
  variant: Exercise;
};

const lessons: Lesson[] = [
  {
    subject: '数学',
    focus: '数轴上的方向与距离',
    objective: '把“向右/向左”和加减号连起来，不靠死记。',
    explanation: '数轴上向右移动表示增加，向左移动表示减少。先写起点，再把移动方向翻译成带符号的数。',
    tip: '先画一条小数轴，再列式；不要只凭感觉猜正负。',
    kind: 'math',
    exercise: {
      id: 'math-number-line-01',
      prompt: '点 A 表示 −3，从 A 向右移动 5 个单位后到点 B。点 B 表示多少？',
      accepted: ['2', 'B=2'],
      source: '双宝题库 · 初一数学 · 有理数专项 01',
    },
    variant: {
      id: 'math-number-line-01-v',
      prompt: '点 C 表示 4，从 C 向左移动 7 个单位。点 C 最后表示多少？',
      accepted: ['-3', 'C=-3'],
      source: '双宝题库 · 初一数学 · 有理数专项 01 · 变式',
    },
  },
  {
    subject: '英语',
    focus: '一般现在时的第三人称单数',
    objective: '看到 he / she / it，能检查谓语动词是否需要变化。',
    explanation: '一般现在时中，主语是 he、she、it 或一个人/物时，实义动词通常加 -s；以 ch 结尾的 watch 加 -es。',
    tip: '先圈主语，再找谓语；不要只盯着括号里的动词。',
    kind: 'english',
    exercise: {
      id: 'english-present-simple-01',
      prompt: 'Lucy ____ (watch) TV after dinner every day. 只填空格里的词。',
      accepted: ['watches'],
      source: '双宝题库 · 初一英语 · 一般现在时 01',
    },
    variant: {
      id: 'english-present-simple-01-v',
      prompt: 'My brother ____ (study) English every evening. 只填空格里的词。',
      accepted: ['studies'],
      source: '双宝题库 · 初一英语 · 一般现在时 01 · 变式',
    },
  },
];

const storageKey = 'twin-stars:xiaobao:wrong-questions';

export function DailyStudy() {
  const [subject, setSubject] = useState<'数学' | '英语'>('数学');
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<'idle' | 'correct' | 'wrong'>('idle');
  const [useVariant, setUseVariant] = useState(false);
  const [wrongQuestions, setWrongQuestions] = useState<WrongQuestion[]>([]);
  const [syncState, setSyncState] = useState<'loading' | 'synced' | 'local'>('loading');
  const lesson = useMemo(() => lessons.find((item) => item.subject === subject)!, [subject]);
  const question = useVariant ? lesson.variant : lesson.exercise;

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    let localItems: WrongQuestion[] = [];
    if (saved) {
      try { localItems = JSON.parse(saved); } catch { localItems = []; }
    }
    const load = async () => {
      try {
        const response = await fetch('/api/wrong-questions?child=xiaobao');
        if (!response.ok) throw new Error('cloud sync unavailable');
        const data = await response.json() as { items?: WrongQuestion[] };
        const cloudItems = data.items ?? [];
        const cloudQuestionIds = new Set(cloudItems.map((item) => item.questionId));
        const pendingItems = localItems.filter((item) => !cloudQuestionIds.has(item.questionId));
        setWrongQuestions([...pendingItems, ...cloudItems]);
        if (pendingItems.length === 0) { setSyncState('synced'); return; }
        const uploaded = await Promise.all(pendingItems.map(async (item) => {
          const upload = await fetch('/api/wrong-questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...item, child: 'xiaobao' }) });
          if (!upload.ok) throw new Error('pending sync failed');
          return (await upload.json() as { item: WrongQuestion }).item;
        }));
        const merged = [...uploaded, ...cloudItems];
        setWrongQuestions(merged);
        window.localStorage.setItem(storageKey, JSON.stringify(merged));
        setSyncState('synced');
      } catch {
        setWrongQuestions(localItems);
        setSyncState('local');
      }
    };
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const selectSubject = (next: '数学' | '英语') => {
    setSubject(next); setAnswer(''); setFeedback('idle'); setUseVariant(false);
  };

  const checkAnswer = () => {
    if (!answer.trim()) return;
    const correct = evaluateAnswer(answer, question.accepted, lesson.kind);
    setFeedback(correct ? 'correct' : 'wrong');
    if (!correct) {
      const entry = createWrongQuestion({
        questionId: question.id,
        subject,
        knowledgePoint: lesson.focus,
        prompt: question.prompt,
        answer: question.accepted[0],
        learnerAnswer: answer,
        source: question.source,
      });
      const next = [entry, ...wrongQuestions.filter((item) => item.questionId !== question.id)];
      setWrongQuestions(next);
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      void fetch('/api/wrong-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...entry, child: 'xiaobao' }),
      }).then(async (response) => {
        if (!response.ok) throw new Error('sync failed');
        const data = await response.json() as { item: WrongQuestion };
        setWrongQuestions((current) => [data.item, ...current.filter((item) => item.questionId !== question.id)]);
        setSyncState('synced');
      }).catch(() => setSyncState('local'));
    }
  };

  const startVariant = () => { setUseVariant(true); setAnswer(''); setFeedback('idle'); };

  return (
    <main className="plan-page plan-page--teal min-h-screen bg-background text-foreground">
      <WorkbenchHeader backHref="/xiaobao" backLabel="小宝成长页" />
      <div className="mx-auto max-w-7xl px-5 py-7 lg:px-8 lg:py-9">
        <section className="plan-banner rounded-[1.75rem] p-6 lg:p-8">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div><p className="text-sm font-semibold text-primary">初一 · 每日 20 分钟</p><h1 className="mt-2 font-heading text-3xl font-bold tracking-[-0.035em] sm:text-4xl">今天只攻一个难点</h1><p className="mt-3 text-sm text-muted-foreground">理解 5 分钟 · 针对练习 10 分钟 · 讲给爸爸听 5 分钟</p></div>
            <div className="flex rounded-2xl bg-white/75 p-1.5">
              {(['数学', '英语'] as const).map((item) => <button key={item} onClick={() => selectSubject(item)} className={`min-h-11 rounded-xl px-5 text-sm font-bold ${subject === item ? 'bg-ink text-white' : 'text-muted-foreground'}`}>{item}</button>)}
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
          <section className="rounded-3xl border border-border bg-card p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3"><span className="rounded-full bg-secondary px-3 py-1.5 text-xs font-bold text-primary">今日难点 · {subject}</span><span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-4" /> 约 20 分钟</span></div>
            <h2 className="mt-4 font-heading text-2xl font-bold">{lesson.focus}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">目标：{lesson.objective}</p>
            <div className="mt-5 rounded-2xl bg-muted/70 p-4"><p className="flex items-center gap-2 font-bold"><BookOpenCheck className="size-5 text-primary" /> 先理解</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{lesson.explanation}</p></div>
            <div className="mt-5 border-t border-border pt-5"><p className="text-xs font-semibold uppercase tracking-[.13em] text-muted-foreground">{useVariant ? '举一反三' : '针对练习'}</p><p className="mt-3 text-lg font-bold leading-8">{question.prompt}</p><p className="mt-2 text-xs text-muted-foreground">出处：{question.source}</p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row"><input value={answer} onChange={(event) => { setAnswer(event.target.value); setFeedback('idle'); }} onKeyDown={(event) => { if (event.key === 'Enter') checkAnswer(); }} placeholder="在这里写答案" className="min-h-12 flex-1 rounded-xl border border-input bg-background px-4 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" /><button onClick={checkAnswer} className="min-h-12 rounded-xl bg-primary px-6 font-bold text-primary-foreground">检查答案</button></div>
              {feedback === 'correct' && <div className="mt-4 rounded-2xl bg-[#e7f5f2] p-4 text-sm text-[#176a62]"><p className="flex items-center gap-2 font-bold"><Check className="size-4" /> 做对了</p><p className="mt-1">现在请不用看网页，把“为什么”讲给爸爸听。</p></div>}
              {feedback === 'wrong' && <div className="mt-4 rounded-2xl bg-[#fff0e9] p-4 text-sm text-[#8e3a22]"><p className="flex items-center gap-2 font-bold"><RotateCcw className="size-4" /> 已收入错题本</p><p className="mt-2 leading-6">正确答案：{question.accepted[0]}。{lesson.tip}</p>{!useVariant && <button onClick={startVariant} className="mt-3 inline-flex items-center gap-1 font-bold underline underline-offset-4">马上做一道变式 <ChevronRight className="size-4" /></button>}</div>}
            </div>
          </section>

          <aside className="space-y-5">
            <section className="rounded-3xl bg-ink p-5 text-white"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.13em] text-white/55"><Brain className="size-4" /> 爸爸怎么陪</p><ol className="mt-4 space-y-3 text-sm text-white/85"><li>1. 先问“你卡在哪一步？”</li><li>2. 让孩子画图或说出依据</li><li>3. 做完变式，再让孩子反讲</li></ol></section>
            <section className="rounded-3xl border border-border bg-card p-5"><div className="flex items-center justify-between"><p className="flex items-center gap-2 font-bold"><Sparkles className="size-5 text-primary" /> 当前错题本</p><span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold">{wrongQuestions.length} 题</span></div><p className="mt-2 text-xs text-muted-foreground">{syncState === 'loading' ? '正在读取…' : syncState === 'synced' ? '已同步到私人学习空间' : '云端暂不可用，已保存在当前设备'}</p>{wrongQuestions.length === 0 ? <p className="mt-4 text-sm leading-6 text-muted-foreground">答错后会自动记录题目、孩子答案、知识点和出处，并安排第 2、7、30 天复习。</p> : <div className="mt-4 space-y-3">{wrongQuestions.slice(0, 3).map((item) => <div key={item.id} className="rounded-2xl bg-muted/70 p-3 text-sm"><p className="font-bold">{item.knowledgePoint}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.prompt}</p><p className="mt-2 text-xs text-primary">下次复习：{item.reviewDates[0]}</p></div>)}</div>}</section>
            <section className="rounded-3xl border border-dashed border-border bg-card p-5"><p className="flex items-center gap-2 font-bold"><Lightbulb className="size-5 text-primary" /> 后续学科</p><p className="mt-2 text-sm leading-6 text-muted-foreground">语文、物理、化学、生物、历史、道法、地理已预留，按学校进度逐步开启。</p></section>
          </aside>
        </div>
      </div>
    </main>
  );
}
