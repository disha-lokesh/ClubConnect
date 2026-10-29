import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import ProfileView from '@/components/ProfileView';

export default async function Profile() {
  const s = await requireRole('STUDENT');
  const d = await withUser(s, async c => ({
    user: (await c.query('SELECT email, full_name, role FROM users WHERE user_id = app_user_id()')).rows[0],
    student: (await c.query('SELECT srn, department, year_of_study, phone FROM students WHERE user_id = app_user_id()')).rows[0] ?? null,
    clubs: (await c.query('SELECT cl.club_id, cl.name, m.member_role FROM club_members m JOIN clubs cl USING (club_id) ORDER BY cl.name')).rows,
  }));
  return <ProfileView user={d.user} student={d.student} clubs={d.clubs} />;
}
