import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { getEvent, myRegistrationFor } from '@/lib/queries';
import { listAnnouncements, getMyFeedback } from '@/lib/mongo';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { Alert, Badge, SeatBar } from '@/components/ui';
import ApiButton from '@/components/ApiButton';
import ApiForm from '@/components/ApiForm';

export default async function StudentEvent({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRole('STUDENT'); const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  const d = await withUser(s, async c => {
    const event = await getEvent(c, id); if (!event) return null;
    const isMember = (await c.query('SELECT EXISTS (SELECT 1 FROM club_members WHERE club_id = $1 AND student_id = app_user_id()) AS m', [event.club_id])).rows[0].m as boolean;
    return { event, reg: await myRegistrationFor(c, id), isMember };
  });
  if (!d) notFound();
  const { event: e, reg, isMember } = d;
  let announcements: Awaited<ReturnType<typeof listAnnouncements>> = []; let annErr = false;
  try { announcements = await listAnnouncements(id); } catch { annErr = true; }
  let feedback: Awaited<ReturnType<typeof getMyFeedback>> = null;
  const canReview = reg?.status === 'CONFIRMED' && reg.present === true && e.phase === 'COMPLETED';
  if (canReview) { try { feedback = await getMyFeedback(id, s.userId); } catch { /* shown without prefill */ } }
  const active = reg && ['PENDING', 'CONFIRMED'].includes(reg.status);
  const blockedByEligibility = e.eligibility === 'CLUB_MEMBERS' && !isMember;
  const taken = e.capacity - e.seats_left;
  return (
    <>
      <p className="small"><Link href="/student/events">← All events</Link></p>
      <div className="row between"><h1>{e.title}</h1><Badge s={e.status === 'APPROVED' ? e.phase : e.status} /></div>
      <p className="muted">{e.club_name} · {e.category_name}</p>
      <div className="grid g2">
        <div className="card">
          <h2>Details</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{e.description || 'No description provided.'}</p>
          <table className="small"><tbody>
            <tr><th>When</th><td>{fmtDateTime(e.start_time)} – {fmtDateTime(e.end_time)}</td></tr>
            <tr><th>Where</th><td>{e.venue_name}, {e.building}</td></tr>
            <tr><th>Fee</th><td>{fmtMoney(e.fee)}</td></tr>
            <tr><th>Register by</th><td>{fmtDateTime(e.registration_deadline)}</td></tr>
            <tr><th>Who can join</th><td>{e.eligibility === 'OPEN' ? 'Any student' : `Members of ${e.club_name}`}</td></tr>
            <tr><th>Approval</th><td>{e.manual_approval ? 'The club approves each registration' : 'Instant confirmation'}</td></tr>
          </tbody></table>
        </div>
        <div className="card">
          <h2>Registration</h2>
          <SeatBar taken={taken} capacity={e.capacity} />
          <p className="small muted">{e.seats_left} of {e.capacity} seats left (pending requests hold a seat)</p>
          {e.status === 'CANCELLED' && <Alert kind="bad">This event was cancelled{e.cancel_reason ? `: ${e.cancel_reason}` : '.'}</Alert>}
          {reg && <p>Your registration: <Badge s={reg.status} />{reg.present === true && <> <Badge s="CONFIRMED" label="Attended" /></>}</p>}
          {reg?.status === 'PENDING' && <Alert kind="info">Waiting for the club to approve your request.</Alert>}
          {active && e.phase === 'UPCOMING' && <ApiButton url={`/api/registrations/${reg.registration_id}/cancel`} label="Cancel my registration" variant="danger" confirm="Cancel your registration?" />}
          {!active && e.status === 'APPROVED' && (
            blockedByEligibility ? <Alert kind="warn">Only members of {e.club_name} can register. <Link href="/student/clubs">Join the club</Link> first.</Alert>
            : e.registration_open ? <ApiButton url={`/api/events/${e.event_id}/register`} label={reg ? 'Register again' : e.manual_approval ? 'Request to register' : 'Register'} variant="primary" />
            : <Alert kind="warn">{e.phase !== 'UPCOMING' ? 'This event has already started.' : e.seats_left <= 0 ? 'This event is full.' : 'The registration deadline has passed.'}</Alert>)}
          {reg && ['REJECTED'].includes(reg.status) && <p className="small muted">The club declined this request.</p>}
        </div>
      </div>
      <h2>Announcements</h2>
      {annErr ? <Alert kind="warn">Announcements are temporarily unavailable.</Alert>
        : announcements.length === 0 ? <p className="muted">No announcements yet.</p>
        : announcements.map(a => <div className="card" key={String(a!._id)}><div className="row between"><b>{a!.pinned ? '📌 ' : ''}{a!.title}</b><span className="small muted">{fmtDateTime(a!.createdAt)}</span></div><p style={{ whiteSpace: 'pre-wrap' }}>{a!.body}</p></div>)}
      {canReview && (
        <div className="card"><h2>Your feedback</h2>
          <ApiForm action={`/api/events/${id}/feedback`} method="PUT" submit={feedback ? 'Update feedback' : 'Submit feedback'} successMessage="Thanks, your feedback was saved."
            fields={[{ name: 'rating', label: 'Rating (1–5)', type: 'number', required: true, min: 1, max: 5, defaultValue: (feedback?.rating as number | undefined) ?? 5 },
              { name: 'comment', label: 'Comment', type: 'textarea', maxLength: 1000, defaultValue: (feedback?.comment as string | undefined) ?? '' },
              { name: 'tags', label: 'Tags (comma separated)', type: 'csv', defaultValue: ((feedback?.tags as string[] | undefined) ?? []).join(', ') }]} />
          {feedback && <div style={{ marginTop: '.6rem' }}><ApiButton url={`/api/events/${id}/feedback`} method="DELETE" label="Delete my feedback" variant="danger" small confirm="Delete your feedback?" /></div>}
        </div>)}
    </>
  );
}
