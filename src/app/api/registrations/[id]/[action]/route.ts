import { ApiError, idParam, readBody, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { attendanceInput, decideInput } from '@/lib/validation';
import { logActivity } from '@/lib/mongo';

export const POST = route(['STUDENT', 'CLUB_ADMIN'], async ({ req, s, params }) => {
  const id = idParam(params.id);
  switch (params.action) {
    case 'cancel': {                                             // student cancels own registration
      if (s.role !== 'STUDENT') throw new ApiError(403, 'Only students can cancel their registration.');
      const r = await withUser(s, async c => (await c.query('SELECT * FROM cancel_registration($1)', [id])).rows[0]);
      await logActivity(s, 'REGISTRATION_CANCELLED', 'registration', id); return { status: r.status };
    }
    case 'decide': {                                             // club approves / rejects a PENDING registration
      if (s.role !== 'CLUB_ADMIN') throw new ApiError(403, 'Only club administrators can decide registrations.');
      const { approve } = await readBody(req, decideInput);
      const r = await withUser(s, async c => (await c.query('SELECT * FROM decide_registration($1,$2)', [id, approve])).rows[0]);
      await logActivity(s, 'REGISTRATION_DECIDED', 'registration', id, { approve }); return { status: r.status };
    }
    case 'attendance': {
      if (s.role !== 'CLUB_ADMIN') throw new ApiError(403, 'Only club administrators can record attendance.');
      const { present } = await readBody(req, attendanceInput);
      const r = await withUser(s, async c => (await c.query('SELECT * FROM mark_attendance($1,$2)', [id, present])).rows[0]);
      await logActivity(s, 'ATTENDANCE_MARKED', 'registration', id, { present }); return { present: r.present };
    }
    default: throw new ApiError(404, 'Unknown action.');
  }
});
