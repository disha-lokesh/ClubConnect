import { route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { reportFeedbackByEvent } from '@/lib/mongo';

export const GET = route(['CLUB_ADMIN'], async ({ s }) => {
  const events = await withUser(s, async c => (await c.query(
    `SELECT * FROM event_registration_summary WHERE club_id IN (SELECT club_id FROM club_admins WHERE user_id = app_user_id()) ORDER BY start_time DESC`)).rows);
  let feedback: unknown[] = []; let feedbackError: string | null = null;
  try { feedback = await reportFeedbackByEvent(events.map(e => e.event_id)); } catch (e) { feedbackError = (e as Error).message; }
  return { events, feedback, feedbackError };
});
