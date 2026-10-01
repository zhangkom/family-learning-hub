import { handleScans } from '@family/scans';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return handleScans(request, 'list');
}
export function POST(request: Request) {
  return handleScans(request, 'list');
}
