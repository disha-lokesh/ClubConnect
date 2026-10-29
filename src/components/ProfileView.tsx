import ApiForm from './ApiForm';
import ApiButton from './ApiButton';
import { Empty } from './ui';

type Props = { user: { email: string; full_name: string; role: string }; student: { srn: string; department: string; year_of_study: number; phone: string | null } | null; clubs: { club_id: number; name: string; member_role: string }[] };
export default function ProfileView({ user, student, clubs }: Props) {
  return (
    <>
      <h1>My profile</h1>
      <div className="grid g2">
        <div className="card">
          <h2>Details</h2>
          <p className="muted small">E-mail: {user.email}{student && <> · SRN: {student.srn}</>} (these cannot be changed here)</p>
          <ApiForm action="/api/profile" method="PATCH" submit="Save changes" successMessage="Profile updated."
            fields={[{ name: 'fullName', label: 'Full name', required: true, defaultValue: user.full_name },
              ...(student ? [{ name: 'department', label: 'Department', required: true, defaultValue: student.department },
                { name: 'yearOfStudy', label: 'Year of study', type: 'number' as const, required: true, min: 1, max: 6, defaultValue: student.year_of_study },
                { name: 'phone', label: 'Phone', defaultValue: student.phone ?? '', hint: 'Digits, +, space or -' }] : [])]} />
        </div>
        {student && (
          <div className="card"><h2>My clubs</h2>
            {clubs.length === 0 ? <Empty>You have not joined any club yet. Some events are open to club members only.</Empty>
              : <table><tbody>{clubs.map(c => <tr key={c.club_id}><td>{c.name}<div className="small muted">{c.member_role === 'MEMBER' ? 'Member' : 'Office bearer'}</div></td>
                  <td className="right"><ApiButton url={`/api/clubs/${c.club_id}/membership`} method="DELETE" label="Leave" small confirm={`Leave ${c.name}?`} /></td></tr>)}</tbody></table>}
            <p className="small muted" style={{ marginTop: '.75rem' }}>Browse and join clubs on the <a href="/student/clubs">Clubs</a> page.</p>
          </div>)}
      </div>
    </>
  );
}
