import { ApiError, route } from '@/lib/api';
import { listActivity, logActivity, purgeActivityOlderThan } from '@/lib/mongo';

export const GET = route(['CAMPUS_ADMIN'], async ({ req }) => {
  const u = req.nextUrl.searchParams;
  return { activity: await listActivity({ actorUserId: u.get('user') ? Number(u.get('user')) : undefined, action: u.get('action') || undefined, limit: Number(u.get('limit') ?? 50) }) };
});
// housekeeping: delete log entries older than N days (N >= 30)
export const DELETE = route(['CAMPUS_ADMIN'], async ({ req, s }) => {
  const days = Number(req.nextUrl.searchParams.get('days'));
  if (!Number.isInteger(days) || days < 30) throw new ApiError(422, 'days must be a whole number of at least 30.');
  const deleted = await purgeActivityOlderThan(days); await logActivity(s, 'ACTIVITY_PURGED', undefined, undefined, { days, deleted }); return { deleted };
});
