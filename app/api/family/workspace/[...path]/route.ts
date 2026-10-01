import { handleWorkspace } from '@family/mobile';
export const dynamic = 'force-dynamic';
async function dispatch(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return handleWorkspace(request, (await context.params).path);
}
export { dispatch as GET, dispatch as POST, dispatch as PUT };
