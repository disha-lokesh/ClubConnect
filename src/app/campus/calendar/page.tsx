import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { calendarEvents } from '@/lib/queries';
import CalendarView, { monthFrom } from '@/components/CalendarView';

export default async function Cal({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const s = await requireRole('CAMPUS_ADMIN'); const { year, month } = monthFrom(await searchParams);
  const events = await withUser(s, c => calendarEvents(c, year, month));
  return <><h1>Calendar</h1><CalendarView events={events} year={year} month={month} path="/campus/calendar" eventBase="/campus/events" /></>;
}
