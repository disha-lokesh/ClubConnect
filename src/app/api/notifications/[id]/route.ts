import { ApiError, idParam, route } from '@/lib/api';
import { withUser } from '@/lib/db';
export const DELETE = route('any', async ({ s, params }) => {
  const n = await withUser(s, async c => (await c.query('DELETE FROM notifications WHERE notification_id = $1', [idParam(params.id)])).rowCount);
  if (!n) throw new ApiError(404, 'Notification not found.'); return { ok: true };
});
