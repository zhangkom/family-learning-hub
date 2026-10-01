import { handleFamily } from '@family/backend';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return handleFamily(request, 'password');
}
