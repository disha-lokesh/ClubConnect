import { route, ApiError } from '@/lib/api';
import { withUser } from '@/lib/db';
import { calendarEvents } from '@/lib/queries';

export const GET = route('any', async ({ req, s }) => {
  const now = new Date(); const u = req.nextUrl.searchParams;
  const year = Number(u.get('year') ?? now.getFullYear()); const month = Number(u.get('month') ?? now.getMonth() + 1);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) throw new ApiError(400, 'Invalid month.');
  return { year, month, events: await withUser(s, c => calendarEvents(c, year, month)) };
});
