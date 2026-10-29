import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { myClubs, referenceData } from '@/lib/queries';
import EventForm from '@/components/EventForm';
import { Alert } from '@/components/ui';

export default async function NewEvent() {
  const s = await requireRole('CLUB_ADMIN');
  const { clubs, ref } = await withUser(s, async c => ({ clubs: await myClubs(c), ref: await referenceData(c) }));
  return (
    <>
      <h1>New event</h1><p className="muted">The event is saved as a draft. Submit it for approval when it is ready; only approved events are visible to students.</p>
      {clubs.length === 0 ? <Alert kind="warn">You are not assigned to any club yet. Ask a campus administrator.</Alert> : <div className="card"><EventForm refData={ref} clubs={clubs.filter(c => c.is_active)} /></div>}
    </>
  );
}
