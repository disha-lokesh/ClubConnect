import Link from 'next/link';
import { dayKey, fmtTime } from '@/lib/format';
import type { EventRow } from '@/lib/queries';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthFrom(sp: { year?: string; month?: string }) {
  const now = new Date(); const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const y = Number(sp.year), m = Number(sp.month);
  return Number.isInteger(y) && y > 2000 && y < 2100 && Number.isInteger(m) && m >= 1 && m <= 12 ? { year: y, month: m } : { year: ist.getFullYear(), month: ist.getMonth() + 1 };
}

/** Month grid. Day labels are plain calendar numbers; each event is placed on its start date in campus time (IST). */
export default function CalendarView({ events, year, month, path, eventBase }: { events: EventRow[]; year: number; month: number; path: string; eventBase: string }) {
  const startDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysIn = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = Math.ceil((startDow + daysIn) / 7) * 7;
  const byDay = new Map<string, EventRow[]>();
  for (const e of events) { const k = dayKey(e.start_time); byDay.set(k, [...(byDay.get(k) ?? []), e]); }
  const today = dayKey(new Date());
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return (
    <>
      <div className="row between" style={{ marginBottom: '.75rem' }}>
        <h2 style={{ margin: 0 }}>{MONTHS[month - 1]} {year}</h2>
        <div className="row">
          <Link className="btn sm" href={`${path}?year=${prev.year}&month=${prev.month}`}>← Previous</Link>
          <Link className="btn sm" href={path}>Today</Link>
          <Link className="btn sm" href={`${path}?year=${next.year}&month=${next.month}`}>Next →</Link>
        </div>
      </div>
      <div className="cal" role="grid" aria-label={`${MONTHS[month - 1]} ${year}`}>
        {DOW.map(d => <div key={d} className="dow" role="columnheader">{d}</div>)}
        {Array.from({ length: cells }, (_, i) => {
          const dayNum = i - startDow + 1; const inMonth = dayNum >= 1 && dayNum <= daysIn;
          const key = inMonth ? `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}` : '';
          const list = inMonth ? byDay.get(key) ?? [] : [];
          return (
            <div key={i} className={`day ${inMonth ? '' : 'off'} ${key === today ? 'today' : ''}`} role="gridcell">
              {inMonth && <div className="num">{dayNum}</div>}
              {list.map(e => (
                <Link key={e.event_id} href={`${eventBase}/${e.event_id}`} title={`${e.title} · ${e.club_name} · ${e.venue_name}`}
                      className={`chip ${e.status === 'PENDING_APPROVAL' ? 'pending' : e.seats_left === 0 ? 'full' : ''}`}>{fmtTime(e.start_time)} {e.title}</Link>))}
            </div>);
        })}
      </div>
      <p className="small muted" style={{ marginTop: '.6rem' }}>Blue = published · Amber = awaiting approval (visible to the organising club and campus admins) · Red = full.</p>
    </>
  );
}
