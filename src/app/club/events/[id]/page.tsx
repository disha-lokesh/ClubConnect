import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { conflictsFor, eventHistory, getEvent, participants, referenceData } from '@/lib/queries';
import { listAnnouncements, listFeedback } from '@/lib/mongo';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { Alert, Badge, SeatBar, Stat } from '@/components/ui';
import ApiButton from '@/components/ApiButton';
import ApiForm from '@/components/ApiForm';
import EventForm from '@/components/EventForm';

export default async function ClubEvent({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRole('CLUB_ADMIN'); const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  const d = await withUser(s, async c => {
    const event = await getEvent(c, id); if (!event) return null;
    const manages = (await c.query('SELECT is_club_admin_of($1) AS m', [event.club_id])).rows[0].m as boolean;
    if (!manages) return { event, manages } as const;
    return { event, manages, summary: (await c.query('SELECT * FROM event_summary($1)', [id])).rows[0], parts: await participants(c, id),
      conflicts: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(event.status) ? await conflictsFor(c, id) : [], history: await eventHistory(c, id),
      ref: event.status === 'DRAFT' ? await referenceData(c) : null } as const;
  });
  if (!d) notFound();
  const e = d.event;
  if (!d.manages) return (<><p className="small"><Link href="/club/events">← My events</Link></p><h1>{e.title}</h1><Alert kind="info">This event belongs to {e.club_name}. You can view it but not manage it.</Alert><p>{fmtDateTime(e.start_time)} · {e.venue_name}</p></>);
  let ann: Awaited<ReturnType<typeof listAnnouncements>> = []; let fb: Awaited<ReturnType<typeof listFeedback>> = []; let mongoDown = false;
  try { [ann, fb] = await Promise.all([listAnnouncements(id), listFeedback(id)]); } catch { mongoDown = true; }
  const sm = d.summary!; const parts = d.parts!;
  const avg = fb.length ? (fb.reduce((a, f) => a + Number(f!.rating), 0) / fb.length).toFixed(1) : null;
  return (
    <>
      <p className="small"><Link href="/club/events">← My events</Link></p>
      <div className="row between"><h1>{e.title}</h1><Badge s={e.status} /></div>
      <p className="muted">{e.club_name} · {fmtDateTime(e.start_time)} – {fmtDateTime(e.end_time)} · {e.venue_name} · {fmtMoney(e.fee)}</p>
      {e.status === 'REJECTED' && <Alert kind="bad">Rejected by campus administration{e.review_comment ? `: ${e.review_comment}` : '.'} Reopen it as a draft, fix the issue and resubmit.</Alert>}
      {e.status === 'CANCELLED' && <Alert kind="bad">Cancelled{e.cancel_reason ? `: ${e.cancel_reason}` : '.'}</Alert>}
      {d.conflicts!.length > 0 && <Alert kind="warn"><b>Venue clash:</b> {d.conflicts!.map(c => `${c.other_title} (${c.other_club}, ${c.other_status})`).join('; ')} use the same venue at an overlapping time. An approved clash cannot be approved by the database.</Alert>}
      <div className="row" style={{ marginBottom: '1rem' }}>
        {e.status === 'DRAFT' && <ApiButton url={`/api/events/${id}/submit`} label="Submit for approval" variant="primary" confirm="Submit this event? You will not be able to edit it while it is pending." />}
        {e.status === 'REJECTED' && <ApiButton url={`/api/events/${id}/reopen`} label="Reopen as draft" />}
        {['PENDING_APPROVAL', 'APPROVED'].includes(e.status) && e.phase !== 'COMPLETED' && <details><summary className="btn danger">Cancel event</summary><div className="card"><ApiForm action={`/api/events/${id}/cancel`} submit="Confirm cancellation" fields={[{ name: 'reason', label: 'Reason (sent to registered students)', required: true, maxLength: 500 }]} /></div></details>}
      </div>
      <div className="grid g4"><Stat n={sm.confirmed} label="Confirmed" /><Stat n={sm.pending} label="Pending" /><Stat n={sm.seats_left} label="Seats left" /><Stat n={sm.attended} label="Attended" /></div>
      <SeatBar taken={e.capacity - e.seats_left} capacity={e.capacity} />
      {e.status === 'DRAFT' && d.ref && <div className="card"><h2>Edit draft</h2><EventForm refData={d.ref} event={e} /></div>}
      <h2>Participants</h2>
      {parts.length === 0 ? <p className="muted">No registrations yet.</p> : (
        <div className="card tablewrap"><table><thead><tr><th>Student</th><th>SRN</th><th>Dept</th><th>Status</th><th>Attendance</th><th /></tr></thead><tbody>
          {parts.map(p => <tr key={p.registration_id}><td>{p.full_name}<div className="small muted">{p.email}</div></td><td>{p.srn}</td><td>{p.department} Y{p.year_of_study}</td><td><Badge s={p.status} /></td>
            <td>{p.present === true ? 'Present' : p.present === false ? 'Absent' : '—'}</td>
            <td className="right">
              {p.status === 'PENDING' && <><ApiButton url={`/api/registrations/${p.registration_id}/decide`} body={{ approve: true }} label="Approve" variant="good" small /> <ApiButton url={`/api/registrations/${p.registration_id}/decide`} body={{ approve: false }} label="Reject" variant="danger" small /></>}
              {p.status === 'CONFIRMED' && e.status === 'APPROVED' && new Date(e.start_time) <= new Date() && <><ApiButton url={`/api/registrations/${p.registration_id}/attendance`} body={{ present: true }} label="Present" small /> <ApiButton url={`/api/registrations/${p.registration_id}/attendance`} body={{ present: false }} label="Absent" small /></>}
            </td></tr>)}
        </tbody></table></div>)}
      <h2>Announcements</h2>
      {mongoDown && <Alert kind="warn">Announcements and feedback are temporarily unavailable.</Alert>}
      {e.status === 'APPROVED' && !mongoDown && <div className="card"><ApiForm action={`/api/events/${id}/announcements`} submit="Post announcement" reset successMessage="Posted."
        fields={[{ name: 'title', label: 'Title', required: true, maxLength: 120 }, { name: 'body', label: 'Message', type: 'textarea', required: true, maxLength: 2000 }, { name: 'tags', label: 'Tags (comma separated)', type: 'csv' }, { name: 'pinned', label: 'Pin to top', type: 'checkbox' }]} /></div>}
      {ann.map(a => <div className="card" key={String(a!._id)}><div className="row between"><b>{a!.pinned ? '📌 ' : ''}{a!.title}</b>
        <ApiButton url={`/api/announcements/${a!._id}`} method="DELETE" label="Delete" variant="danger" small confirm="Delete this announcement?" /></div><p style={{ whiteSpace: 'pre-wrap' }}>{a!.body}</p>
        <details><summary className="small">Edit</summary><ApiForm action={`/api/announcements/${a!._id}`} method="PATCH" submit="Save" fields={[{ name: 'title', label: 'Title', required: true, defaultValue: a!.title }, { name: 'body', label: 'Message', type: 'textarea', required: true, defaultValue: a!.body }, { name: 'pinned', label: 'Pinned', type: 'checkbox', defaultValue: !!a!.pinned }]} /></details></div>)}
      <h2>Feedback {avg && <span className="muted">· average {avg}/5 from {fb.length}</span>}</h2>
      {fb.length === 0 ? <p className="muted">No feedback yet. Feedback is anonymous.</p> : fb.slice(0, 10).map(f => <div className="card" key={String(f!._id)}><b>{'★'.repeat(Number(f!.rating))}{'☆'.repeat(5 - Number(f!.rating))}</b> {f!.comment as string}<div className="small muted">{((f!.tags as string[]) ?? []).join(', ')}</div></div>)}
      <h2>Status history</h2>
      <ul className="timeline">{d.history!.map((h, i) => <li key={i}>{h.old_status ? `${h.old_status} → ` : ''}<b>{h.new_status}</b> <span className="small muted">by {h.changed_by ?? 'system'} · {fmtDateTime(h.changed_at)}</span></li>)}</ul>
    </>
  );
}
