import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import ApiForm from '@/components/ApiForm';
import ApiButton from '@/components/ApiButton';
import { Badge } from '@/components/ui';

export default async function CampusClubs() {
  const s = await requireRole('CAMPUS_ADMIN');
  const d = await withUser(s, async c => ({
    clubs: (await c.query('SELECT club_id, name, description, contact_email, is_active FROM clubs ORDER BY name')).rows,
    admins: (await c.query('SELECT ca.club_id, u.user_id, u.full_name, u.email FROM club_admins ca JOIN users u USING (user_id) ORDER BY u.full_name')).rows,
    clubAdminUsers: (await c.query(`SELECT user_id, full_name, email FROM users WHERE role = 'CLUB_ADMIN' ORDER BY full_name`)).rows,
  }));
  const userOpts = d.clubAdminUsers.map(u => ({ value: u.user_id, label: `${u.full_name} (${u.email})` }));
  return (
    <>
      <h1>Clubs & staff accounts</h1>
      <div className="grid g2">
        <div className="card"><h2>Create a club</h2><ApiForm action="/api/clubs" submit="Create club" reset successMessage="Club created." fields={[{ name: 'name', label: 'Name', required: true }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'contactEmail', label: 'Contact e-mail', type: 'email' }]} /></div>
        <div className="card"><h2>Create a staff account</h2><p className="small muted">Club and campus administrator accounts can only be created here. Each account has exactly one role.</p>
          <ApiForm action="/api/staff" submit="Create account" reset successMessage="Account created." fields={[{ name: 'fullName', label: 'Full name', required: true }, { name: 'email', label: 'E-mail', type: 'email', required: true },
            { name: 'password', label: 'Initial password', type: 'password', required: true, hint: '8+ characters, upper, lower and a digit' },
            { name: 'role', label: 'Role', type: 'select', required: true, options: [{ value: 'CLUB_ADMIN', label: 'Club admin' }, { value: 'CAMPUS_ADMIN', label: 'Campus admin' }] },
            { name: 'clubId', label: 'Assign to club (club admins)', type: 'select', options: d.clubs.map(c => ({ value: c.club_id, label: c.name })) }]} /></div>
      </div>
      {d.clubs.map(c => { const admins = d.admins.filter(a => a.club_id === c.club_id); return (
        <div className="card" key={c.club_id}><div className="row between"><h3>{c.name}</h3><Badge s={c.is_active ? 'APPROVED' : 'CANCELLED'} label={c.is_active ? 'Active' : 'Inactive'} /></div>
          <p className="muted small">{c.description}</p>
          <p className="small"><b>Administrators:</b> {admins.length === 0 ? 'none' : admins.map(a => <span key={a.user_id}>{a.full_name} <ApiButton url={`/api/clubs/${c.club_id}/admins`} method="DELETE" body={{ userId: a.user_id }} label="Remove" small confirm={`Remove ${a.full_name} from ${c.name}?`} /> </span>)}</p>
          <div className="row"><details><summary className="small">Assign an administrator</summary><ApiForm action={`/api/clubs/${c.club_id}/admins`} submit="Assign" fields={[{ name: 'userId', label: 'Club admin account', type: 'select', required: true, options: userOpts }]} /></details>
            <details><summary className="small">Edit club</summary><ApiForm action={`/api/clubs/${c.club_id}`} method="PATCH" submit="Save" fields={[{ name: 'name', label: 'Name', required: true, defaultValue: c.name }, { name: 'description', label: 'Description', type: 'textarea', defaultValue: c.description }, { name: 'contactEmail', label: 'Contact e-mail', type: 'email', defaultValue: c.contact_email ?? '' }, { name: 'isActive', label: 'Active', type: 'checkbox', defaultValue: c.is_active }]} /></details></div></div>); })}
    </>
  );
}
