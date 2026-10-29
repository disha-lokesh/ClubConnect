import { created, readBody, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { clubInput } from '@/lib/validation';
import { logActivity } from '@/lib/mongo';

export const GET = route('any', async ({ s }) => ({ clubs: await withUser(s, async c => (await c.query(
  `SELECT cl.club_id, cl.name, cl.description, cl.contact_email, cl.is_active,
          (SELECT count(*)::int FROM club_members m WHERE m.club_id = cl.club_id) AS members_visible,
          EXISTS (SELECT 1 FROM club_members m WHERE m.club_id = cl.club_id AND m.student_id = app_user_id()) AS is_member
     FROM clubs cl ORDER BY cl.name`)).rows) }));

export const POST = route(['CAMPUS_ADMIN'], async ({ req, s }) => {
  const v = await readBody(req, clubInput);
  const id = await withUser(s, async c => (await c.query('INSERT INTO clubs (name, description, contact_email) VALUES ($1,$2,NULLIF($3,\'\')) RETURNING club_id', [v.name, v.description, v.contactEmail ?? ''])).rows[0].club_id);
  await logActivity(s, 'CLUB_CREATED', 'club', id); return created({ clubId: id });
});
