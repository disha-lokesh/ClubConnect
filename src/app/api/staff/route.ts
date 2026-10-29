import { created, readBody, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { staffInput } from '@/lib/validation';
import { logActivity } from '@/lib/mongo';

// Only a campus administrator can create club-admin / campus-admin accounts (create_staff_user() re-checks inside PostgreSQL).
export const POST = route(['CAMPUS_ADMIN'], async ({ req, s }) => {
  const v = await readBody(req, staffInput); const hash = await hashPassword(v.password);
  const id = await withUser(s, async c => (await c.query('SELECT create_staff_user($1,$2,$3,$4,$5) AS id', [v.email, hash, v.fullName, v.role, v.clubId ?? null])).rows[0].id);
  await logActivity(s, 'STAFF_CREATED', 'user', id, { role: v.role }); return created({ userId: id });
});
