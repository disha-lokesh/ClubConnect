import Link from 'next/link';
import { fmtDateTime, fmtMoney, humanStatus } from '@/lib/format';
import type { EventRow } from '@/lib/queries';

const TONE: Record<string, string> = {
  APPROVED: 'b-ok', CONFIRMED: 'b-ok', PUBLISHED: 'b-ok', PRESENT: 'b-ok',
  PENDING: 'b-warn', PENDING_APPROVAL: 'b-warn', DRAFT: 'b-gray', UPCOMING: 'b-info', ONGOING: 'b-warn',
  REJECTED: 'b-bad', CANCELLED: 'b-bad', ABSENT: 'b-bad', COMPLETED: 'b-gray',
};
export const Badge = ({ s, label }: { s: string; label?: string }) => <span className={`badge ${TONE[s] ?? ''}`}>{label ?? humanStatus(s)}</span>;

export const Empty = ({ children }: { children: React.ReactNode }) => <div className="empty">{children}</div>;
export const Alert = ({ kind = 'info', children }: { kind?: 'bad' | 'ok' | 'warn' | 'info'; children: React.ReactNode }) => <div className={`alert a-${kind}`} role={kind === 'bad' ? 'alert' : undefined}>{children}</div>;

export function SeatBar({ taken, capacity }: { taken: number; capacity: number }) {
  const pct = Math.min(100, Math.round((taken / capacity) * 100));
  return <div className={`seatbar ${taken >= capacity ? 'full' : ''}`} role="img" aria-label={`${taken} of ${capacity} seats taken`}><i style={{ width: `${pct}%` }} /></div>;
}

export function EventCard({ e, href }: { e: EventRow; href: string }) {
  const taken = e.capacity - e.seats_left;
  return (
    <div className="card ev">
      <div className="row between"><Badge s={e.phase} />{e.status !== 'APPROVED' && <Badge s={e.status} />}</div>
      <h3><Link href={href}>{e.title}</Link></h3>
      <div className="meta">{e.club_name} · {e.category_name}</div>
      <div className="meta">{fmtDateTime(e.start_time)} · {e.venue_name}</div>
      <SeatBar taken={taken} capacity={e.capacity} />
      <div className="row between small"><span>{e.seats_left > 0 ? `${e.seats_left} of ${e.capacity} seats left` : 'Full'}</span><b>{fmtMoney(e.fee)}</b></div>
      {e.eligibility === 'CLUB_MEMBERS' && <span className="badge b-info">Club members only</span>}
    </div>
  );
}

export function Stat({ n, label }: { n: number | string; label: string }) { return <div className="card stat"><b>{n}</b><span>{label}</span></div>; }
