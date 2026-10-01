import { handleFamily } from '@family/backend';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return handleFamily(request, 'session');
}
