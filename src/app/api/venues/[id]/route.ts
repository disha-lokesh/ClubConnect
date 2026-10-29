import { ApiError, idParam, readBody, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { venueInput } from '@/lib/validation';
import { logActivity } from '@/lib/mongo';
export const PATCH = route(['CAMPUS_ADMIN'], async ({ req, s, params }) => {
  const id = idParam(params.id); const v = await readBody(req, venueInput.partial());
  const n = await withUser(s, async c => (await c.query(`UPDATE venues SET name=COALESCE($2,name), building=COALESCE($3,building), capacity=COALESCE($4,capacity), is_active=COALESCE($5,is_active) WHERE venue_id=$1`,
    [id, v.name ?? null, v.building ?? null, v.capacity ?? null, v.isActive ?? null])).rowCount);
  if (!n) throw new ApiError(404, 'Venue not found.'); await logActivity(s, 'VENUE_UPDATED', 'venue', id); return { ok: true };
});
