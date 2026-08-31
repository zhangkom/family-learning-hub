import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getAppUser } from '@/app/auth';
import { getDb } from '@/db';
import { scanItems } from '@/db/schema';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAppUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { id } = await context.params;
  const [record] = await getDb()
    .select({ objectKey: scanItems.objectKey, originalName: scanItems.originalName, mimeType: scanItems.mimeType })
    .from(scanItems)
    .where(and(eq(scanItems.id, id), eq(scanItems.ownerId, user.userId)))
    .limit(1);
  if (!record) return new Response('Not found', { status: 404 });

  const object = await env.FILES.get(record.objectKey);
  if (!object?.body) return new Response('Not found', { status: 404 });
  return new Response(object.body, {
    headers: {
      'Content-Type': record.mimeType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(record.originalName)}`,
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': 'sandbox',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
