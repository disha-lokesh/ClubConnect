import { idParam, readBody, route, created } from '@/lib/api';
import { withUser } from '@/lib/db';
import { assignAdminInput } from '@/lib/validation';
import { logActivity } from '@/lib/mongo';

export const POST = route(['CAMPUS_ADMIN'], async ({ req, s, params }) => {
  const id = idParam(params.id); const { userId } = await readBody(req, assignAdminInput);
  await withUser(s, c => c.query('INSERT INTO club_admins (club_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, userId]));
  await logActivity(s, 'CLUB_ADMIN_ASSIGNED', 'club', id, { userId }); return created({ ok: true });
});
export const DELETE = route(['CAMPUS_ADMIN'], async ({ req, s, params }) => {
  const id = idParam(params.id); const { userId } = await readBody(req, assignAdminInput);
  await withUser(s, c => c.query('DELETE FROM club_admins WHERE club_id = $1 AND user_id = $2', [id, userId]));
  await logActivity(s, 'CLUB_ADMIN_REMOVED', 'club', id, { userId }); return { ok: true };
});
