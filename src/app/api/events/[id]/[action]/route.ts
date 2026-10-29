import { ApiError, idParam, readBody, route } from '@/lib/api';
import { withUser, type Role } from '@/lib/db';
import { reasonInput, reviewInput } from '@/lib/validation';
import { logActivity } from '@/lib/mongo';

const ALLOWED: Record<string, Role[]> = { submit: ['CLUB_ADMIN'], reopen: ['CLUB_ADMIN'], cancel: ['CLUB_ADMIN', 'CAMPUS_ADMIN'], review: ['CAMPUS_ADMIN'], register: ['STUDENT'] };

// All state changes go through SECURITY DEFINER functions in PostgreSQL, which re-check role and club ownership.
export const POST = route('any', async ({ req, s, params }) => {
  const id = idParam(params.id); const action = params.action;
  if (!ALLOWED[action]) throw new ApiError(404, 'Unknown action.');
  if (!ALLOWED[action].includes(s.role)) throw new ApiError(403, 'Your role cannot do this.');
  switch (action) {
    case 'submit': {
      const r = await withUser(s, async c => (await c.query('SELECT * FROM submit_event($1)', [id])).rows[0]);
      await logActivity(s, 'EVENT_SUBMITTED', 'event', id); return { status: r.status };
    }
    case 'reopen': {
      const r = await withUser(s, async c => (await c.query('SELECT * FROM reopen_event($1)', [id])).rows[0]);
      await logActivity(s, 'EVENT_REOPENED', 'event', id); return { status: r.status };
    }
    case 'cancel': {
      const { reason } = await readBody(req, reasonInput);
      const r = await withUser(s, async c => (await c.query('SELECT * FROM cancel_event($1,$2)', [id, reason])).rows[0]);
      await logActivity(s, 'EVENT_CANCELLED', 'event', id, { reason }); return { status: r.status };
    }
    case 'review': {
      const { approve, comment } = await readBody(req, reviewInput);
      const r = await withUser(s, async c => (await c.query('SELECT * FROM review_event($1,$2,$3)', [id, approve, comment ?? null])).rows[0]);
      await logActivity(s, 'EVENT_REVIEWED', 'event', id, { approve }); return { status: r.status };
    }
    default: { // register
      const r = await withUser(s, async c => (await c.query('SELECT * FROM register_for_event($1)', [id])).rows[0]);
      await logActivity(s, 'REGISTRATION_CREATED', 'event', id, { status: r.status });
      return { registrationId: r.registration_id, status: r.status };
    }
  }
});
