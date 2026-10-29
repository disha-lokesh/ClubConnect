import { ApiError, idParam, readBody, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { conflictsFor, eventHistory, getEvent, myRegistrationFor } from '@/lib/queries';
import { eventInput } from '@/lib/validation';
import { listAnnouncements, logActivity } from '@/lib/mongo';

export const GET = route('any', async ({ s, params }) => {
  const id = idParam(params.id);
  const data = await withUser(s, async c => {
    const event = await getEvent(c, id);                       // RLS: students never see drafts / pending / rejected events
    if (!event) throw new ApiError(404, 'Event not found.');
    const manages = s.role === 'CLUB_ADMIN' && (await c.query('SELECT is_club_admin_of($1) AS m', [event.club_id])).rows[0].m;
    const staff = manages || s.role === 'CAMPUS_ADMIN';
    return {
      event,
      myRegistration: s.role === 'STUDENT' ? await myRegistrationFor(c, id) : null,
      manages: !!manages,
      summary: staff ? (await c.query('SELECT * FROM event_summary($1)', [id])).rows[0] : null,
      conflicts: staff && ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(event.status) ? await conflictsFor(c, id) : [],
      history: staff ? await eventHistory(c, id) : [],
    };
  });
  let announcements: unknown[] = []; let announcementsError: string | null = null;
  try { announcements = await listAnnouncements(id); } catch (e) { announcementsError = (e as Error).message; }
  return { ...data, announcements, announcementsError };
});

// Edit a DRAFT (the database trigger rejects edits to events that are no longer drafts)
export const PATCH = route(['CLUB_ADMIN'], async ({ req, s, params }) => {
  const id = idParam(params.id); const v = await readBody(req, eventInput);
  const n = await withUser(s, async c => (await c.query(
    `UPDATE events SET category_id=$2, venue_id=$3, title=$4, description=$5, start_time=$6, end_time=$7, registration_deadline=$8,
            capacity=$9, fee=$10, eligibility=$11, manual_approval=$12 WHERE event_id=$1`,
    [id, v.categoryId, v.venueId, v.title, v.description, v.startTime, v.endTime, v.registrationDeadline, v.capacity, v.fee, v.eligibility, v.manualApproval])).rowCount);
  if (!n) throw new ApiError(404, 'Event not found or not yours.');
  await logActivity(s, 'EVENT_UPDATED', 'event', id);
  return { ok: true };
});
