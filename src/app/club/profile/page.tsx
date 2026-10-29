import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import ProfileView from '@/components/ProfileView';

export default async function Profile() {
  const s = await requireRole('CLUB_ADMIN');
  const user = await withUser(s, async c => (await c.query('SELECT email, full_name, role FROM users WHERE user_id = app_user_id()')).rows[0]);
  return <ProfileView user={user} student={null} clubs={[]} />;
}
