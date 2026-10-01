import { handleFamily } from '@family/backend';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return handleFamily(request, 'sync');
}
export function POST(request: Request) {
  return handleFamily(request, 'sync');
}
