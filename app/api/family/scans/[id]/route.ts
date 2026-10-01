import { handleScans } from '@family/scans';
export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleScans(request, 'item', (await context.params).id);
}
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleScans(request, 'item', (await context.params).id);
}
