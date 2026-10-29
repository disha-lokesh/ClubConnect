import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { asLogin, type Role, type Session } from './db';

const COOKIE = 'cc_session';
const MAX_AGE = 8 * 60 * 60;
const key = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters');
  return new TextEncoder().encode(s);
};

export async function createSession(s: Session) {
  const token = await new SignJWT({ role: s.role, name: s.name })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(String(s.userId)).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(key());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: MAX_AGE });
}
export async function destroySession() { (await cookies()).delete(COOKIE); }

/** Verified session or null. Re-checks the account in PostgreSQL on every call (deactivation / role change take effect at once). */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let userId: number; 
  try { const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] }); userId = Number(payload.sub); } catch { return null; }
  if (!Number.isInteger(userId)) return null;
  const row = await asLogin(async c => (await c.query('SELECT * FROM session_check($1)', [userId])).rows[0]);
  if (!row || !row.is_active) return null;
  return { userId, role: row.role as Role, name: row.full_name };
}
