import { idParam, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { logActivity } from '@/lib/mongo';

export const POST = route(['STUDENT'], async ({ s, params }) => {
  const id = idParam(params.id);
  await withUser(s, async c => c.query('INSERT INTO club_members (club_id, student_id) VALUES ($1, app_user_id()) ON CONFLICT DO NOTHING', [id]));
  await logActivity(s, 'CLUB_JOINED', 'club', id); return { ok: true };
});
export const DELETE = route(['STUDENT'], async ({ s, params }) => {
  const id = idParam(params.id);
  await withUser(s, async c => c.query('DELETE FROM club_members WHERE club_id = $1', [id]));       // RLS: only own row can match
  await logActivity(s, 'CLUB_LEFT', 'club', id); return { ok: true };
});
