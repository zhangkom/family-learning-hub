import { handleScans } from '@family/scans';
export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleScans(request, 'file', (await context.params).id);
}
