import { ApiError, idParam, readBody, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { deleteFeedback, feedbackInput, getMyFeedback, listFeedback, logActivity, reportFeedbackByEvent, saveFeedback } from '@/lib/mongo';

// Students: read/save/delete their OWN feedback (only if they attended).  Club/campus admins: anonymised list + average.
export const GET = route('any', async ({ s, params }) => {
  const id = idParam(params.id);
  if (s.role === 'STUDENT') return { mine: await getMyFeedback(id, s.userId) };
  await withUser(s, async c => { if (!(await c.query('SELECT 1 FROM events WHERE event_id=$1', [id])).rowCount) throw new ApiError(404, 'Event not found.'); });
  return { feedback: await listFeedback(id), summary: (await reportFeedbackByEvent([id]))[0] ?? null };
});
export const PUT = route(['STUDENT'], async ({ req, s, params }) => {
  const id = idParam(params.id); const input = await readBody(req, feedbackInput);
  const attended = await withUser(s, async c => (await c.query('SELECT attended FROM student_participation_history WHERE event_id=$1 AND registration_status=\'CONFIRMED\'', [id])).rows[0]?.attended);
  if (attended !== true) throw new ApiError(403, 'Feedback is open to students who attended the event.');
  const doc = await saveFeedback(id, s.userId, input); await logActivity(s, 'FEEDBACK_SAVED', 'event', id); return doc;
});
export const DELETE = route(['STUDENT'], async ({ s, params }) => { await deleteFeedback(idParam(params.id), s.userId); return { ok: true }; });
