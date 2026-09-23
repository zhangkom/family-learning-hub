export const cloudSyncEnabled = process.env.NEXT_PUBLIC_SELF_HOSTED !== 'true';

export function appPath(path: string): string {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  return `${basePath}${path}`;
}
