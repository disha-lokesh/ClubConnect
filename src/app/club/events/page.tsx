import Link from 'next/link';
import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { clubEvents } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { Badge, Empty } from '@/components/ui';

export default async function ClubEvents() {
  const s = await requireRole('CLUB_ADMIN');
  const events = await withUser(s, clubEvents);
  return (
    <>
      <div className="row between"><h1>My events</h1><Link className="btn primary" href="/club/events/new">New event</Link></div>
      {events.length === 0 ? <Empty>No events yet.</Empty> : (
        <div className="card tablewrap"><table><thead><tr><th>Event</th><th>Club</th><th>When</th><th>Venue</th><th>Seats</th><th>Status</th></tr></thead><tbody>
          {events.map(e => <tr key={e.event_id}><td><Link href={`/club/events/${e.event_id}`}>{e.title}</Link></td><td>{e.club_name}</td><td>{fmtDateTime(e.start_time)}</td><td>{e.venue_name}</td><td>{e.capacity - e.seats_left}/{e.capacity}</td><td><Badge s={e.status} /></td></tr>)}
        </tbody></table></div>)}
    </>
  );
}
