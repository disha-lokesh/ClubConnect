import Link from 'next/link';
import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { allEvents, conflictsFor } from '@/lib/queries';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { Alert, Empty } from '@/components/ui';

export default async function Approvals() {
  const s = await requireRole('CAMPUS_ADMIN');
  const items = await withUser(s, async c => { const ev = await allEvents(c, 'PENDING_APPROVAL'); return Promise.all(ev.map(async e => ({ e, conflicts: await conflictsFor(c, e.event_id) }))); });
  return (
    <>
      <h1>Approvals</h1><p className="muted">Open an event to approve or reject it. Approval is blocked by the database if another approved event already holds the venue at that time.</p>
      {items.length === 0 ? <Empty>Nothing to review.</Empty> : items.map(({ e, conflicts }) => (
        <div className="card" key={e.event_id}><div className="row between"><h3><Link href={`/campus/events/${e.event_id}`}>{e.title}</Link></h3><span className="small muted">{e.club_name}</span></div>
          <p className="small">{fmtDateTime(e.start_time)} – {fmtDateTime(e.end_time)} · {e.venue_name} · capacity {e.capacity} · {fmtMoney(e.fee)}</p>
          {conflicts.length > 0 && <Alert kind="warn">Overlaps with {conflicts.map(c => `${c.other_title} (${c.other_status})`).join(', ')}</Alert>}</div>))}
    </>
  );
}
