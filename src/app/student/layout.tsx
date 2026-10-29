import Shell from '@/components/Shell';
import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { unreadCount } from '@/lib/queries';

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const s = await requireRole('STUDENT');
  const unread = await withUser(s, unreadCount);
  return (
    <Shell s={s} home="/student/calendar" nav={[
      { href: '/student', label: 'Dashboard', exact: true }, { href: '/student/events', label: 'Events' }, { href: '/student/calendar', label: 'Calendar' },
      { href: '/student/registrations', label: 'My registrations' }, { href: '/student/history', label: 'History' }, { href: '/student/clubs', label: 'Clubs' },
      { href: '/student/notifications', label: 'Notifications', badge: unread }, { href: '/student/profile', label: 'Profile' }]}>{children}</Shell>
  );
}
