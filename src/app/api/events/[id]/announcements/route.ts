import { ApiError, created, idParam, readBody, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { getEvent } from '@/lib/queries';
import { announcementInput, createAnnouncement, listAnnouncements, logActivity } from '@/lib/mongo';

export const GET = route('any', async ({ s, params }) => {
  const id = idParam(params.id);
  await withUser(s, async c => { if (!(await getEvent(c, id))) throw new ApiError(404, 'Event not found.'); });   // visibility decided by PostgreSQL RLS
  return { announcements: await listAnnouncements(id) };
});

// Only an administrator of the event's club may post. Authorisation is decided in PostgreSQL, the post is stored in MongoDB.
export const POST = route(['CLUB_ADMIN'], async ({ req, s, params }) => {
  const id = idParam(params.id); const input = await readBody(req, announcementInput);
  const clubId = await withUser(s, async c => {
    const e = await getEvent(c, id); if (!e) throw new ApiError(404, 'Event not found.');
    if (!(await c.query('SELECT is_club_admin_of($1) AS m', [e.club_id])).rows[0].m) throw new ApiError(403, 'You do not manage this club.');
    if (e.status !== 'APPROVED') throw new ApiError(409, 'Announcements can only be posted for published events.');
    return e.club_id as number;
  });
  const doc = await createAnnouncement(id, clubId, s.userId, input);
  await logActivity(s, 'ANNOUNCEMENT_POSTED', 'event', id);
  return created(doc);
});
