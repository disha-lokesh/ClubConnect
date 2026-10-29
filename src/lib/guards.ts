import { redirect } from 'next/navigation';
import { getSession } from './session';
import { HOME } from './auth';
import type { Role, Session } from './db';

/** For server components: send visitors to the login page / their own area. (The API and PostgreSQL enforce access independently.) */
export async function requireRole(role: Role): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  if (s.role !== role) redirect(HOME[s.role]);
  return s;
}
