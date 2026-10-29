import Shell from '@/components/Shell';
import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { unreadCount } from '@/lib/queries';

export default async function CampusLayout({ children }: { children: React.ReactNode }) {
  const s = await requireRole('CAMPUS_ADMIN');
  const d = await withUser(s, async c => ({ unread: await unreadCount(c), pending: (await c.query(`SELECT count(*)::int n FROM events WHERE status = 'PENDING_APPROVAL'`)).rows[0].n as number }));
  return (
    <Shell s={s} home="/campus/calendar" nav={[{ href: '/campus', label: 'Dashboard', exact: true }, { href: '/campus/approvals', label: 'Approvals', badge: d.pending }, { href: '/campus/events', label: 'All events' },
      { href: '/campus/calendar', label: 'Calendar' }, { href: '/campus/clubs', label: 'Clubs & staff' }, { href: '/campus/venues', label: 'Venues' },
      { href: '/campus/conflicts', label: 'Conflicts' }, { href: '/campus/reports', label: 'Reports' }, { href: '/campus/activity', label: 'Activity log' },
      { href: '/campus/notifications', label: 'Notifications', badge: d.unread }, { href: '/campus/profile', label: 'Profile' }]}>{children}</Shell>
  );
}
