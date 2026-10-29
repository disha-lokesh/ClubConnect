import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { Badge } from '@/components/ui';
import ApiButton from '@/components/ApiButton';

export default async function Clubs() {
  const s = await requireRole('STUDENT');
  const clubs = await withUser(s, async c => (await c.query(`SELECT cl.club_id, cl.name, cl.description, cl.contact_email,
      EXISTS (SELECT 1 FROM club_members m WHERE m.club_id = cl.club_id AND m.student_id = app_user_id()) AS is_member
      FROM clubs cl WHERE cl.is_active ORDER BY cl.name`)).rows);
  return (
    <>
      <h1>Clubs</h1><p className="muted">Some events are open to club members only. Joining is instant.</p>
      <div className="grid g2">{clubs.map(c => (
        <div className="card" key={c.club_id}><div className="row between"><h3>{c.name}</h3>{c.is_member && <Badge s="CONFIRMED" label="Member" />}</div>
          <p className="muted">{c.description || 'No description.'}</p>{c.contact_email && <p className="small">{c.contact_email}</p>}
          {c.is_member ? <ApiButton url={`/api/clubs/${c.club_id}/membership`} method="DELETE" label="Leave club" small confirm={`Leave ${c.name}?`} /> : <ApiButton url={`/api/clubs/${c.club_id}/membership`} label="Join club" variant="primary" small />}
        </div>))}</div>
    </>
  );
}
