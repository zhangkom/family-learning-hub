import { env } from 'cloudflare:workers';
import { and, desc, eq } from 'drizzle-orm';
import { getAppUser } from '@/app/auth';
import { getDb } from '@/db';
import { scanItems } from '@/db/schema';
import { MAX_SCAN_BYTES, sanitizeDisplayName, validateScanFile } from '@/lib/upload-security';

const seniorSubjects = new Set(['数学', '物理', '化学', '生物']);

export async function GET() {
  const user = await getAppUser();
  if (!user) return Response.json({ error: '请先登录私人学习空间' }, { status: 401 });
  const rows = await getDb()
    .select({ id: scanItems.id, subject: scanItems.subject, source: scanItems.source, originalName: scanItems.originalName, mimeType: scanItems.mimeType, size: scanItems.size, status: scanItems.status, createdAt: scanItems.createdAt })
    .from(scanItems)
    .where(and(eq(scanItems.ownerId, user.userId), eq(scanItems.child, 'dabao')))
    .orderBy(desc(scanItems.createdAt))
    .limit(100);
  return Response.json({ items: rows.map((item) => ({ ...item, fileUrl: `/api/scans/${item.id}/file` })) });
}

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user) return Response.json({ error: '请先登录私人学习空间' }, { status: 401 });
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_SCAN_BYTES + 1024 * 1024) return Response.json({ error: '上传内容过大' }, { status: 413 });
  const form = await request.formData();
  const file = form.get('file');
  const subjectValue = form.get('subject');
  const sourceValue = form.get('source');
  const subject = typeof subjectValue === 'string' ? subjectValue : '';
  const source = typeof sourceValue === 'string' ? sourceValue.trim() : '';
  if (!(file instanceof File) || !seniorSubjects.has(subject) || !source || source.length > 200) return Response.json({ error: '扫描件、学科或出处无效' }, { status: 400 });

  const validation = await validateScanFile(file);
  if (!validation.ok) return Response.json({ error: validation.reason }, { status: 400 });
  const id = crypto.randomUUID();
  const objectKey = `scans/${id}.${validation.extension}`;
  const createdAt = new Date().toISOString();
  const item = { id, ownerId: user.userId, child: 'dabao' as const, subject, source, originalName: sanitizeDisplayName(file.name), objectKey, mimeType: validation.mime, size: file.size, status: '待讲解', createdAt };

  await env.FILES.put(objectKey, file.stream(), { httpMetadata: { contentType: validation.mime } });
  try {
    await getDb().insert(scanItems).values(item);
  } catch (error) {
    await env.FILES.delete(objectKey);
    throw error;
  }
  return Response.json({ item: { id, subject, source, originalName: item.originalName, mimeType: item.mimeType, size: item.size, status: item.status, createdAt, fileUrl: `/api/scans/${id}/file` } }, { status: 201 });
}
