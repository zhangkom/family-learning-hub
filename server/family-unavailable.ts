export async function handleFamily() {
  return Response.json(
    { enabled: false, user: null, error: '家庭同步请使用腾讯云版本' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
export const handleScans = handleFamily;
export async function handleMobile() {
  return Response.json(
    { error: '移动端接口请使用腾讯云独立服务', code: 'UNAVAILABLE' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
export const handleWorkspace = handleMobile;
