import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { conflictsFor, eventHistory, getEvent } from '@/lib/queries';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { Alert, Badge, SeatBar, Stat } from '@/components/ui';
import ApiButton from '@/components/ApiButton';
import ApiForm from '@/components/ApiForm';

export default async function CampusEvent({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRole('CAMPUS_ADMIN'); const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  const d = await withUser(s, async c => { const event = await getEvent(c, id); if (!event) return null;
    return { event, summary: (await c.query('SELECT * FROM event_summary($1)', [id])).rows[0], conflicts: await conflictsFor(c, id), history: await eventHistory(c, id) }; });
  if (!d) notFound();
  const e = d.event;
  return (
    <>
      <p className="small"><Link href="/campus/events">← All events</Link></p>
      <div className="row between"><h1>{e.title}</h1><Badge s={e.status} /></div>
      <p className="muted">{e.club_name} · {e.category_name}</p>
      <div className="card"><p style={{ whiteSpace: 'pre-wrap' }}>{e.description || 'No description.'}</p>
        <table className="small"><tbody><tr><th>When</th><td>{fmtDateTime(e.start_time)} – {fmtDateTime(e.end_time)}</td></tr><tr><th>Venue</th><td>{e.venue_name}, {e.building} (venue capacity {e.venue_capacity})</td></tr>
          <tr><th>Capacity / fee</th><td>{e.capacity} · {fmtMoney(e.fee)}</td></tr><tr><th>Eligibility</th><td>{e.eligibility === 'OPEN' ? 'Any student' : 'Club members only'}{e.manual_approval ? ' · manual approval' : ''}</td></tr></tbody></table></div>
      {d.conflicts.length > 0 && <Alert kind="warn"><b>Venue overlap:</b> {d.conflicts.map(c => `${c.other_title} – ${c.other_club} (${c.other_status}, ${fmtDateTime(c.other_start)})`).join('; ')}</Alert>}
      <div className="grid g4"><Stat n={d.summary.confirmed} label="Confirmed" /><Stat n={d.summary.pending} label="Pending" /><Stat n={d.summary.seats_left} label="Seats left" /><Stat n={d.summary.attended} label="Attended" /></div>
      <SeatBar taken={e.capacity - e.seats_left} capacity={e.capacity} />
      {e.status === 'PENDING_APPROVAL' && <div className="card"><h2>Review</h2>
        <ApiForm action={`/api/events/${id}/review`} submit="Reject" secondary fields={[{ name: 'comment', label: 'Comment (shown to the club; required when rejecting)', type: 'textarea', maxLength: 500 }]} extra={{ approve: false }} />
        <div style={{ marginTop: '.8rem' }}><ApiButton url={`/api/events/${id}/review`} body={{ approve: true }} label="Approve and publish" variant="primary" confirm="Approve this event and publish it to students?" /></div></div>}
      {['PENDING_APPROVAL', 'APPROVED'].includes(e.status) && e.phase !== 'COMPLETED' && <details><summary className="btn danger">Cancel event</summary><div className="card"><ApiForm action={`/api/events/${id}/cancel`} submit="Confirm cancellation" fields={[{ name: 'reason', label: 'Reason', required: true, maxLength: 500 }]} /></div></details>}
      {e.review_comment && <Alert kind="info">Review comment: {e.review_comment}</Alert>}
      <h2>Status history</h2>
      <ul className="timeline">{d.history.map((h, i) => <li key={i}>{h.old_status ? `${h.old_status} → ` : ''}<b>{h.new_status}</b> <span className="small muted">by {h.changed_by ?? 'system'} · {fmtDateTime(h.changed_at)}</span></li>)}</ul>
    </>
  );
}
