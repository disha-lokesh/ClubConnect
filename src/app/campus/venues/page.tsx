import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { referenceData } from '@/lib/queries';
import ApiForm from '@/components/ApiForm';
import { Badge } from '@/components/ui';

export default async function Venues() {
  const s = await requireRole('CAMPUS_ADMIN');
  const { venues } = await withUser(s, referenceData);
  return (
    <>
      <h1>Venues</h1>
      <div className="card"><h2>Add a venue</h2><ApiForm action="/api/venues" submit="Add venue" reset successMessage="Venue added." fields={[{ name: 'name', label: 'Name', required: true }, { name: 'building', label: 'Building', required: true }, { name: 'capacity', label: 'Capacity', type: 'number', required: true, min: 1 }]} /></div>
      <div className="card tablewrap"><table><thead><tr><th>Venue</th><th>Building</th><th>Capacity</th><th>State</th><th>Edit</th></tr></thead><tbody>
        {venues.map(v => <tr key={v.venue_id}><td>{v.name}</td><td>{v.building}</td><td>{v.capacity}</td><td><Badge s={v.is_active ? 'APPROVED' : 'CANCELLED'} label={v.is_active ? 'Active' : 'Inactive'} /></td>
          <td><details><summary className="small">Edit</summary><ApiForm action={`/api/venues/${v.venue_id}`} method="PATCH" submit="Save" fields={[{ name: 'name', label: 'Name', required: true, defaultValue: v.name }, { name: 'building', label: 'Building', required: true, defaultValue: v.building }, { name: 'capacity', label: 'Capacity', type: 'number', required: true, min: 1, defaultValue: v.capacity }, { name: 'isActive', label: 'Active', type: 'checkbox', defaultValue: v.is_active }]} /></details></td></tr>)}
      </tbody></table></div>
    </>
  );
}
