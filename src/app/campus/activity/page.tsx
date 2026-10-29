import { requireRole } from '@/lib/guards';
import { listActivity } from '@/lib/mongo';
import { fmtDateTime } from '@/lib/format';
import DataTable from '@/components/DataTable';
import ApiForm from '@/components/ApiForm';
import { Alert } from '@/components/ui';

export default async function Activity({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  await requireRole('CAMPUS_ADMIN'); const action = (await searchParams).action || undefined;
  let rows: Record<string, unknown>[] | null = null;
  try { rows = (await listActivity({ action, limit: 100 })).map(r => ({ ...r!, when: fmtDateTime(r!.createdAt as Date), entity: r!.entityType ? `${r!.entityType} #${r!.entityId ?? ''}` : '' })); } catch { /* notice below */ }
  return (
    <>
      <h1>Activity log</h1><p className="muted">Every important action is logged to MongoDB (flexible documents). Entries older than 180 days are removed automatically by a TTL index on a real MongoDB server.</p>
      <form className="card filters" method="get"><div><label htmlFor="action">Filter by action</label><input id="action" name="action" defaultValue={action} placeholder="e.g. EVENT_REVIEWED" /></div><div className="row"><button className="btn primary">Filter</button></div></form>
      {!rows ? <Alert kind="warn">The activity log (MongoDB) is temporarily unavailable.</Alert> : <div className="card"><DataTable rows={rows} cols={{ when: 'When', action: 'Action', actorRole: 'Role', actorUserId: 'User', entity: 'Entity', metadata: 'Details' }} empty="No log entries." /></div>}
      <div className="card"><h2>Housekeeping</h2><p className="small muted">Delete log entries older than a number of days (minimum 30).</p>
        <p className="small muted">This performs a MongoDB delete through the API.</p>
        <ApiForm action="/api/activity?days=90" method="DELETE" submit="Purge entries older than 90 days" fields={[]} /></div>
    </>
  );
}
