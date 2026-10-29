import { publicRoute, readBody, ApiError } from '@/lib/api';
import { asLogin } from '@/lib/db';
import { createSession } from '@/lib/session';
import { DUMMY_HASH, HOME, verifyPassword } from '@/lib/auth';
import { loginInput } from '@/lib/validation';
import { clearAttempts, recordAttempt, tooManyAttempts } from '@/lib/ratelimit';
import { logActivity } from '@/lib/mongo';

export const POST = publicRoute(async ({ req }) => {
  const { email, password } = await readBody(req, loginInput);
  const key = `${email.toLowerCase()}|${req.headers.get('x-forwarded-for') ?? 'local'}`;
  if (tooManyAttempts(key)) throw new ApiError(429, 'Too many failed attempts. Please wait a few minutes and try again.');
  const row = await asLogin(async c => (await c.query('SELECT * FROM authenticate_lookup($1)', [email])).rows[0]);
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) {
    recordAttempt(key);
    await logActivity({ userId: row?.user_id ?? null, role: 'ANONYMOUS' }, 'LOGIN_FAILED', undefined, undefined, { emailDomain: email.split('@')[1] });
    throw new ApiError(401, 'Incorrect e-mail or password.');
  }
  if (!row.is_active) throw new ApiError(403, 'This account has been deactivated.');
  clearAttempts(key);
  await createSession({ userId: row.user_id, role: row.role, name: row.full_name });
  await logActivity({ userId: row.user_id, role: row.role }, 'LOGIN');
  return { role: row.role, name: row.full_name, redirect: HOME[row.role as keyof typeof HOME] };
});
