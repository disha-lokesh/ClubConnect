import { z } from 'zod';
import { readBody, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { myNotifications, unreadCount } from '@/lib/queries';

export const GET = route('any', async ({ s }) => withUser(s, async c => ({ notifications: await myNotifications(c), unread: await unreadCount(c) })));

// mark some (ids) or all notifications as read. RLS means a user can only ever touch their own rows.
export const POST = route('any', async ({ req, s }) => {
  const v = await readBody(req, z.object({ ids: z.array(z.number().int().positive()).max(500).optional(), all: z.boolean().optional() }).refine(x => x.ids || x.all, 'ids or all required'));
  const n = await withUser(s, async c => v.all ? (await c.query('UPDATE notifications SET is_read = TRUE WHERE NOT is_read')).rowCount
                                                : (await c.query('UPDATE notifications SET is_read = TRUE WHERE notification_id = ANY($1)', [v.ids])).rowCount);
  return { updated: n };
});
