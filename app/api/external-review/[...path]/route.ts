import { handleExternalReview } from '@family/admin';
export const dynamic = 'force-dynamic';
async function dispatch(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return handleExternalReview(request, (await context.params).path);
}
export { dispatch as GET, dispatch as POST };
