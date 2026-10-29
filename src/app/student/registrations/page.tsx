import Link from 'next/link';
import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { myRegistrations } from '@/lib/queries';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { Badge, Empty } from '@/components/ui';
import ApiButton from '@/components/ApiButton';

export default async function Regs() {
  const s = await requireRole('STUDENT');
  const all = await withUser(s, myRegistrations);
  const live = all.filter(r => ['PENDING', 'CONFIRMED'].includes(r.registration_status) && new Date(r.end_time) > new Date());
  return (
    <>
      <h1>My registrations</h1><p className="muted">Events you are signed up for, or waiting on. Past events are under <Link href="/student/history">History</Link>.</p>
      {live.length === 0 ? <Empty>You have no active registrations. <Link href="/student/events">Find an event</Link></Empty> : (
        <div className="card tablewrap"><table><thead><tr><th>Event</th><th>When</th><th>Fee</th><th>Status</th><th /></tr></thead><tbody>
          {live.map(r => <tr key={r.registration_id}>
            <td><Link href={`/student/events/${r.event_id}`}>{r.title}</Link><div className="small muted">{r.club_name} · {r.venue_name}</div></td>
            <td>{fmtDateTime(r.start_time)}</td><td>{fmtMoney(r.fee)}</td><td><Badge s={r.registration_status} />{r.event_status === 'CANCELLED' && <> <Badge s="CANCELLED" label="Event cancelled" /></>}</td>
            <td className="right">{r.can_cancel_time && r.event_status === 'APPROVED' && <ApiButton url={`/api/registrations/${r.registration_id}/cancel`} label="Cancel" variant="danger" small confirm="Cancel this registration?" />}</td></tr>)}
        </tbody></table></div>)}
    </>
  );
}
