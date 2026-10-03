import { handleAdmin } from '@family/admin';
export const dynamic = 'force-dynamic';
async function dispatch(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return handleAdmin(request, (await context.params).path);
}
export { dispatch as GET, dispatch as POST };
