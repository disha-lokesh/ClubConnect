import Link from 'next/link';
import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { listPublished, myNotifications, myRegistrations, unreadCount } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { Badge, Empty, EventCard, Stat } from '@/components/ui';

export default async function StudentHome() {
  const s = await requireRole('STUDENT');
  const d = await withUser(s, async c => ({ regs: await myRegistrations(c), open: await listPublished(c, { when: 'upcoming', openOnly: true }), notes: await myNotifications(c, 4), unread: await unreadCount(c) }));
  const now = Date.now();
  const upcoming = d.regs.filter(r => ['CONFIRMED', 'PENDING'].includes(r.registration_status) && new Date(r.start_time).getTime() > now);
  const attended = d.regs.filter(r => r.attended === true).length;
  return (
    <>
      <h1>Hello, {s.name.split(' ')[0]}</h1><p className="muted">Here is what is happening on campus.</p>
      <div className="grid g4">
        <Stat n={upcoming.filter(r => r.registration_status === 'CONFIRMED').length} label="Confirmed upcoming events" />
        <Stat n={upcoming.filter(r => r.registration_status === 'PENDING').length} label="Waiting for club approval" />
        <Stat n={attended} label="Events attended" /><Stat n={d.unread} label="Unread notifications" />
      </div>
      <div className="grid g2">
        <div className="card"><h2>My upcoming events</h2>
          {upcoming.length === 0 ? <Empty>No upcoming registrations. <Link href="/student/events">Browse events</Link></Empty>
            : <table><tbody>{upcoming.slice(0, 6).map(r => <tr key={r.registration_id}><td><Link href={`/student/events/${r.event_id}`}>{r.title}</Link><div className="small muted">{fmtDateTime(r.start_time)} · {r.venue_name}</div></td><td className="right"><Badge s={r.registration_status} /></td></tr>)}</tbody></table>}
        </div>
        <div className="card"><h2>Latest notifications</h2>
          {d.notes.length === 0 ? <Empty>Nothing yet.</Empty> : <ul className="timeline">{d.notes.map(n => <li key={n.notification_id} style={{ fontWeight: n.is_read ? 400 : 600 }}>{n.message}<div className="small muted">{fmtDateTime(n.created_at)}</div></li>)}</ul>}
          <p className="small" style={{ marginTop: '.6rem' }}><Link href="/student/notifications">See all</Link></p>
        </div>
      </div>
      <div className="row between"><h2>Open for registration</h2><Link href="/student/events">All events →</Link></div>
      {d.open.length === 0 ? <Empty>No events are open for registration right now.</Empty> : <div className="grid g3">{d.open.slice(0, 6).map(e => <EventCard key={e.event_id} e={e} href={`/student/events/${e.event_id}`} />)}</div>}
    </>
  );
}
