import { route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { profileInput } from '@/lib/validation';
import { readBody } from '@/lib/api';

export const GET = route('any', async ({ s }) => withUser(s, async c => {
  const u = (await c.query('SELECT user_id, email, full_name, role FROM users WHERE user_id = app_user_id()')).rows[0];
  const st = s.role === 'STUDENT' ? (await c.query('SELECT srn, department, year_of_study, phone FROM students WHERE user_id = app_user_id()')).rows[0] : null;
  const clubs = s.role === 'STUDENT' ? (await c.query(`SELECT cl.club_id, cl.name, m.member_role, m.joined_on FROM club_members m JOIN clubs cl USING (club_id) ORDER BY cl.name`)).rows : [];
  return { user: u, student: st, clubs };
}));
export const PATCH = route('any', async ({ req, s }) => {
  const v = await readBody(req, profileInput);
  await withUser(s, async c => {
    if (v.fullName) await c.query('UPDATE users SET full_name = $1 WHERE user_id = app_user_id()', [v.fullName]);
    if (s.role === 'STUDENT' && (v.department || v.yearOfStudy || v.phone !== undefined))
      await c.query(`UPDATE students SET department = COALESCE($1, department), year_of_study = COALESCE($2, year_of_study),
                            phone = CASE WHEN $3::text IS NULL THEN phone WHEN $3 = '' THEN NULL ELSE $3 END WHERE user_id = app_user_id()`,
        [v.department ?? null, v.yearOfStudy ?? null, v.phone ?? null]);
  });
  return { ok: true };
});
