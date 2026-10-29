import Link from 'next/link';
import { fmtDateTime } from '@/lib/format';
import ApiButton from './ApiButton';
import { Empty } from './ui';

type N = { notification_id: number; event_id: number | null; type: string; message: string; is_read: boolean; created_at: Date };
export default function NotificationsView({ items, unread, eventBase }: { items: N[]; unread: number; eventBase: string }) {
  return (
    <>
      <div className="row between"><h1>Notifications</h1>{unread > 0 && <ApiButton url="/api/notifications" body={{ all: true }} label={`Mark all ${unread} as read`} small />}</div>
      <p className="muted">Created automatically by the database whenever an event or registration changes.</p>
      {items.length === 0 ? <Empty>You have no notifications yet.</Empty> : (
        <div className="card tablewrap"><table><tbody>
          {items.map(n => (
            <tr key={n.notification_id} style={{ fontWeight: n.is_read ? 400 : 600 }}>
              <td style={{ width: 14 }}>{!n.is_read && <span className="badge" aria-label="unread">•</span>}</td>
              <td>{n.event_id ? <Link href={`${eventBase}/${n.event_id}`}>{n.message}</Link> : n.message}<div className="small muted">{fmtDateTime(n.created_at)}</div></td>
              <td className="right">{!n.is_read && <ApiButton url="/api/notifications" body={{ ids: [n.notification_id] }} label="Mark read" small />} <ApiButton url={`/api/notifications/${n.notification_id}`} method="DELETE" label="Dismiss" small /></td>
            </tr>))}
        </tbody></table></div>)}
    </>
  );
}
