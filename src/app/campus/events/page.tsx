import Link from 'next/link';
import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { allEvents } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { Badge } from '@/components/ui';

const STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED'];
export default async function CampusEvents({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const s = await requireRole('CAMPUS_ADMIN'); const st = (await searchParams).status;
  const status = STATUSES.includes(st ?? '') ? st : undefined;
  const events = await withUser(s, c => allEvents(c, status));
  return (
    <>
      <h1>All events</h1>
      <div className="row"><Link className={`btn ${!status ? 'primary' : ''}`} href="/campus/events">All</Link>{STATUSES.map(x => <Link key={x} className={`btn ${status === x ? 'primary' : ''}`} href={`/campus/events?status=${x}`}>{x.replace('_', ' ').toLowerCase()}</Link>)}</div>
      <div className="card tablewrap"><table><thead><tr><th>Event</th><th>Club</th><th>When</th><th>Venue</th><th>Seats</th><th>Status</th></tr></thead><tbody>
        {events.map(e => <tr key={e.event_id}><td><Link href={`/campus/events/${e.event_id}`}>{e.title}</Link></td><td>{e.club_name}</td><td>{fmtDateTime(e.start_time)}</td><td>{e.venue_name}</td><td>{e.capacity - e.seats_left}/{e.capacity}</td><td><Badge s={e.status} /></td></tr>)}
      </tbody></table></div>
    </>
  );
}
