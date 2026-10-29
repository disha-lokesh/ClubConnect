import { created, publicRoute, readBody } from '@/lib/api';
import { asLogin } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { registerInput } from '@/lib/validation';
import { logActivity } from '@/lib/mongo';

// Public sign-up can only create STUDENT accounts (enforced again inside register_student()).
export const POST = publicRoute(async ({ req }) => {
  const v = await readBody(req, registerInput);
  const hash = await hashPassword(v.password);
  const id = await asLogin(async c => (await c.query('SELECT register_student($1,$2,$3,$4,$5,$6,$7) AS id',
    [v.email, hash, v.fullName, v.srn, v.department, v.yearOfStudy, v.phone ?? ''])).rows[0].id);
  await logActivity({ userId: id, role: 'STUDENT' }, 'ACCOUNT_CREATED');
  return created({ ok: true });
});
