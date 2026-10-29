import { ApiError, readBody, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { announcementPatch, deleteAnnouncement, getAnnouncement, logActivity, updateAnnouncement } from '@/lib/mongo';

async function authorise(s: Parameters<typeof withUser>[0], aid: string) {
  const doc = await getAnnouncement(aid);
  if (!doc) throw new ApiError(404, 'Announcement not found.');
  const ok = await withUser(s, async c => (await c.query('SELECT is_club_admin_of($1) AS m', [doc.clubId])).rows[0].m);
  if (!ok) throw new ApiError(403, 'You do not manage this club.');
  return doc;
}
export const PATCH = route(['CLUB_ADMIN'], async ({ req, s, params }) => {
  await authorise(s, params.aid); const patch = await readBody(req, announcementPatch);
  const doc = await updateAnnouncement(params.aid, patch); await logActivity(s, 'ANNOUNCEMENT_UPDATED', 'announcement'); return doc;
});
export const DELETE = route(['CLUB_ADMIN'], async ({ s, params }) => {
  await authorise(s, params.aid); await deleteAnnouncement(params.aid); await logActivity(s, 'ANNOUNCEMENT_DELETED', 'announcement'); return { ok: true };
});
