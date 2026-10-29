import Link from 'next/link';
import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { allEvents } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { Badge, Empty, Stat } from '@/components/ui';

export default async function CampusHome() {
  const s = await requireRole('CAMPUS_ADMIN');
  const d = await withUser(s, async c => ({ pending: await allEvents(c, 'PENDING_APPROVAL'),
    counts: (await c.query(`SELECT (SELECT count(*) FROM clubs WHERE is_active)::int clubs, (SELECT count(*) FROM students)::int students,
        (SELECT count(*) FROM events WHERE status='APPROVED' AND end_time > now())::int upcoming, (SELECT count(*) FROM venue_conflicts)::int conflicts`)).rows[0] }));
  return (
    <>
      <h1>Campus dashboard</h1>
      <div className="grid g4"><Stat n={d.pending.length} label="Awaiting your approval" /><Stat n={d.counts.upcoming} label="Upcoming published events" /><Stat n={d.counts.clubs} label="Active clubs" /><Stat n={d.counts.conflicts} label="Venue conflicts" /></div>
      <div className="card"><div className="row between"><h2>Approval queue</h2><Link href="/campus/approvals">Open →</Link></div>
        {d.pending.length === 0 ? <Empty>No events are waiting for review.</Empty> : <table><tbody>{d.pending.slice(0, 6).map(e => <tr key={e.event_id}><td><Link href={`/campus/events/${e.event_id}`}>{e.title}</Link><div className="small muted">{e.club_name} · {fmtDateTime(e.start_time)}</div></td><td className="right"><Badge s={e.status} /></td></tr>)}</tbody></table>}</div>
    </>
  );
}
