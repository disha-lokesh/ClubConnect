import Link from 'next/link';
import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { myRegistrations } from '@/lib/queries';
import { fmtDate } from '@/lib/format';
import { Badge, Empty, Stat } from '@/components/ui';

export default async function History() {
  const s = await requireRole('STUDENT');
  const past = (await withUser(s, myRegistrations)).filter(r => new Date(r.end_time) <= new Date() || ['CANCELLED', 'REJECTED'].includes(r.registration_status));
  const attended = past.filter(r => r.attended === true).length;
  return (
    <>
      <h1>Participation history</h1>
      <div className="grid g3"><Stat n={past.length} label="Past records" /><Stat n={attended} label="Attended" /><Stat n={past.filter(r => r.registration_status === 'CONFIRMED' && r.attended === false).length} label="Confirmed but absent" /></div>
      {past.length === 0 ? <Empty>No history yet.</Empty> : (
        <div className="card tablewrap"><table><thead><tr><th>Event</th><th>Club</th><th>Date</th><th>Registration</th><th>Attendance</th></tr></thead><tbody>
          {past.map(r => <tr key={r.registration_id}><td><Link href={`/student/events/${r.event_id}`}>{r.title}</Link></td><td>{r.club_name}</td><td>{fmtDate(r.start_time)}</td>
            <td><Badge s={r.registration_status} /></td><td>{r.attended === true ? <Badge s="CONFIRMED" label="Present" /> : r.attended === false ? <Badge s="REJECTED" label="Absent" /> : <span className="muted">—</span>}</td></tr>)}
        </tbody></table></div>)}
    </>
  );
}
