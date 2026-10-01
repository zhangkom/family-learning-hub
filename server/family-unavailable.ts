export async function handleFamily() {
  return Response.json(
    { enabled: false, user: null, error: '家庭同步请使用腾讯云版本' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
export const handleScans = handleFamily;
