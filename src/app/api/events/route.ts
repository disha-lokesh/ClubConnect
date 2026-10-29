import { z } from 'zod';
import { created, readBody, route, ApiError } from '@/lib/api';
import { withUser } from '@/lib/db';
import { listPublished } from '@/lib/queries';
import { eventCreateInput } from '@/lib/validation';
import { logActivity } from '@/lib/mongo';

const num = (v: string | null) => (v != null && v !== '' ? Number(v) : undefined);
const filters = z.object({
  q: z.string().max(100).optional(), clubId: z.number().int().positive().optional(), categoryId: z.number().int().positive().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  maxFee: z.number().min(0).optional(), when: z.enum(['upcoming', 'past', 'all']).optional(), openOnly: z.boolean().optional(),
});

// Catalogue of published events (any logged-in role)
export const GET = route('any', async ({ req, s }) => {
  const u = req.nextUrl.searchParams;
  const f = filters.parse({ q: u.get('q') || undefined, clubId: num(u.get('club')), categoryId: num(u.get('category')), from: u.get('from') || undefined,
    to: u.get('to') || undefined, maxFee: num(u.get('maxFee')), when: u.get('when') || undefined, openOnly: u.get('open') === '1' });
  return { events: await withUser(s, c => listPublished(c, f)) };
});

// Club administrator creates a DRAFT event
export const POST = route(['CLUB_ADMIN'], async ({ req, s }) => {
  const v = await readBody(req, eventCreateInput);
  const id = await withUser(s, async c => (await c.query(
    `INSERT INTO events (club_id, category_id, venue_id, title, description, start_time, end_time, registration_deadline, capacity, fee, eligibility, manual_approval, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING event_id`,
    [v.clubId, v.categoryId, v.venueId, v.title, v.description, v.startTime, v.endTime, v.registrationDeadline, v.capacity, v.fee, v.eligibility, v.manualApproval, s.userId])).rows[0].event_id);
  await logActivity(s, 'EVENT_CREATED', 'event', id, { clubId: v.clubId });
  return created({ eventId: id });
});
