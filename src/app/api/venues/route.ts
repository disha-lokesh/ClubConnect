import { created, readBody, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { venueInput } from '@/lib/validation';
import { logActivity } from '@/lib/mongo';
export const GET = route('any', async ({ s }) => ({ venues: await withUser(s, async c => (await c.query('SELECT venue_id, name, building, capacity, is_active FROM venues ORDER BY name')).rows) }));
export const POST = route(['CAMPUS_ADMIN'], async ({ req, s }) => {
  const v = await readBody(req, venueInput);
  const id = await withUser(s, async c => (await c.query('INSERT INTO venues (name, building, capacity) VALUES ($1,$2,$3) RETURNING venue_id', [v.name, v.building, v.capacity])).rows[0].venue_id);
  await logActivity(s, 'VENUE_CREATED', 'venue', id); return created({ venueId: id });
});
