import Link from 'next/link';
import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { clubEvents, myClubs } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { Badge, Empty, Stat } from '@/components/ui';

export default async function ClubHome() {
  const s = await requireRole('CLUB_ADMIN');
  const d = await withUser(s, async c => ({
    clubs: await myClubs(c), events: await clubEvents(c),
    pendingRegs: (await c.query(`SELECT r.registration_id, r.event_id, e.title, u.full_name FROM registrations r JOIN events e USING (event_id) JOIN users u ON u.user_id = r.student_id
                                  WHERE r.status = 'PENDING' AND e.club_id IN (SELECT club_id FROM club_admins WHERE user_id = app_user_id()) ORDER BY r.registered_at LIMIT 8`)).rows,
  }));
  const by = (st: string) => d.events.filter(e => e.status === st).length;
  return (
    <>
      <h1>Club dashboard</h1><p className="muted">Managing: {d.clubs.map(c => c.name).join(', ') || 'no clubs assigned yet'}</p>
      <div className="grid g4"><Stat n={by('DRAFT')} label="Drafts" /><Stat n={by('PENDING_APPROVAL')} label="Awaiting campus approval" /><Stat n={by('APPROVED')} label="Published" /><Stat n={d.pendingRegs.length} label="Registrations to review" /></div>
      <div className="grid g2">
        <div className="card"><h2>Registrations waiting for you</h2>
          {d.pendingRegs.length === 0 ? <Empty>Nothing to review.</Empty> : <table><tbody>{d.pendingRegs.map(r => <tr key={r.registration_id}><td>{r.full_name}</td><td><Link href={`/club/events/${r.event_id}`}>{r.title}</Link></td></tr>)}</tbody></table>}</div>
        <div className="card"><h2>Recent events</h2>
          {d.events.length === 0 ? <Empty>No events yet. <Link href="/club/events/new">Create one</Link></Empty> : <table><tbody>{d.events.slice(0, 6).map(e => <tr key={e.event_id}><td><Link href={`/club/events/${e.event_id}`}>{e.title}</Link><div className="small muted">{fmtDateTime(e.start_time)}</div></td><td className="right"><Badge s={e.status} /></td></tr>)}</tbody></table>}</div>
      </div>
    </>
  );
}
