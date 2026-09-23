import { and, desc, eq } from 'drizzle-orm';
import { getAppUser } from '@/app/auth';
import { getDb } from '@/db';
import { wrongQuestions } from '@/db/schema';
import { buildReviewDates } from '@/lib/learning';

const juniorSubjects = new Set(['数学', '英语', '地理']);
const requiredFields = ['questionId', 'knowledgePoint', 'prompt', 'answer', 'learnerAnswer', 'source'] as const;

export async function GET(request: Request) {
  const user = await getAppUser();
  if (!user) return Response.json({ error: '请先登录私人学习空间' }, { status: 401 });
  const child = new URL(request.url).searchParams.get('child');
  if (child !== 'xiaobao') return Response.json({ error: '无效的孩子标识' }, { status: 400 });

  const rows = await getDb()
    .select({
      id: wrongQuestions.id,
      questionId: wrongQuestions.questionId,
      subject: wrongQuestions.subject,
      knowledgePoint: wrongQuestions.knowledgePoint,
      prompt: wrongQuestions.prompt,
      answer: wrongQuestions.answer,
      learnerAnswer: wrongQuestions.learnerAnswer,
      source: wrongQuestions.source,
      status: wrongQuestions.status,
      reviewDates: wrongQuestions.reviewDates,
      createdOn: wrongQuestions.createdAt,
    })
    .from(wrongQuestions)
    .where(and(eq(wrongQuestions.ownerId, user.userId), eq(wrongQuestions.child, child)))
    .orderBy(desc(wrongQuestions.createdAt))
    .limit(100);
  return Response.json({ items: rows });
}

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user) return Response.json({ error: '请先登录私人学习空间' }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return Response.json({ error: '提交内容无效' }, { status: 400 });
  const record = body as Record<string, unknown>;
  const invalidField = requiredFields.find((field) => typeof record[field] !== 'string' || !(record[field] as string).trim() || (record[field] as string).length > 1000);
  if (invalidField || !juniorSubjects.has(String(record.subject))) return Response.json({ error: '题目字段不完整或过长' }, { status: 400 });

  const now = new Date();
  const item = {
    id: crypto.randomUUID(),
    ownerId: user.userId,
    child: 'xiaobao' as const,
    subject: String(record.subject),
    questionId: String(record.questionId),
    knowledgePoint: String(record.knowledgePoint),
    prompt: String(record.prompt),
    answer: String(record.answer),
    learnerAnswer: String(record.learnerAnswer),
    source: String(record.source),
    status: '待重做',
    reviewDates: buildReviewDates(now),
    createdAt: now.toISOString(),
  };
  const [stored] = await getDb()
    .insert(wrongQuestions)
    .values(item)
    .onConflictDoUpdate({
      target: [wrongQuestions.ownerId, wrongQuestions.child, wrongQuestions.questionId],
      set: { learnerAnswer: item.learnerAnswer, answer: item.answer, status: item.status, reviewDates: item.reviewDates, createdAt: item.createdAt },
    })
    .returning({
      id: wrongQuestions.id,
      questionId: wrongQuestions.questionId,
      subject: wrongQuestions.subject,
      knowledgePoint: wrongQuestions.knowledgePoint,
      prompt: wrongQuestions.prompt,
      answer: wrongQuestions.answer,
      learnerAnswer: wrongQuestions.learnerAnswer,
      source: wrongQuestions.source,
      status: wrongQuestions.status,
      reviewDates: wrongQuestions.reviewDates,
      createdOn: wrongQuestions.createdAt,
    });
  return Response.json({ item: stored }, { status: 201 });
}
