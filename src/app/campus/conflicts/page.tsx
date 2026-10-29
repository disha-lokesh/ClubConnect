import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import DataTable from '@/components/DataTable';

export default async function Conflicts() {
  const s = await requireRole('CAMPUS_ADMIN');
  const rows = await withUser(s, async c => (await c.query('SELECT * FROM venue_conflicts ORDER BY overlap_start')).rows);
  return (
    <>
      <h1>Venue conflicts</h1><p className="muted">Pairs of pending or approved events that overlap in the same venue (view <code>venue_conflicts</code>). Two <i>approved</i> events can never overlap: an exclusion constraint prevents it, so conflicts listed here involve at least one pending event.</p>
      <div className="card"><DataTable rows={rows} empty="No conflicts right now." cols={{ venue_name: 'Venue', title_a: 'Event A', status_a: 'Status', title_b: 'Event B', status_b: 'Status ', overlap_start: 'Overlap from', overlap_end: 'to' }} /></div>
    </>
  );
}
