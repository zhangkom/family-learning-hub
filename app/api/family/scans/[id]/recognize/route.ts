import { handleScans } from '@family/scans';
export const dynamic = 'force-dynamic';
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleScans(request, 'recognize', (await context.params).id);
}
