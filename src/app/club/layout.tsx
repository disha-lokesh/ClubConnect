import Shell from '@/components/Shell';
import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { unreadCount } from '@/lib/queries';

export default async function ClubLayout({ children }: { children: React.ReactNode }) {
  const s = await requireRole('CLUB_ADMIN');
  const unread = await withUser(s, unreadCount);
  return (
    <Shell s={s} home="/club/calendar" nav={[{ href: '/club', label: 'Dashboard', exact: true }, { href: '/club/events', label: 'My events' }, { href: '/club/events/new', label: 'New event' },
      { href: '/club/calendar', label: 'Calendar' }, { href: '/club/notifications', label: 'Notifications', badge: unread }, { href: '/club/profile', label: 'Profile' }]}>{children}</Shell>
  );
}
