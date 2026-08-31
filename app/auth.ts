import { headers } from 'next/headers';

export type AppUser = { userId: string; email: string };

export async function getAppUser(): Promise<AppUser | null> {
  const requestHeaders = await headers();
  const userId = requestHeaders.get('oai-authenticated-user-id');
  const email = requestHeaders.get('oai-authenticated-user-email');

  if (userId && email) return { userId, email };
  if (process.env.NODE_ENV !== 'production') return { userId: 'local-development', email: 'local@development.invalid' };
  return null;
}
