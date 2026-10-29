import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { myNotifications, unreadCount } from '@/lib/queries';
import NotificationsView from '@/components/NotificationsView';

export default async function Notes() {
  const s = await requireRole('CAMPUS_ADMIN');
  const d = await withUser(s, async c => ({ items: await myNotifications(c), unread: await unreadCount(c) }));
  return <NotificationsView items={d.items} unread={d.unread} eventBase="/campus/events" />;
}
