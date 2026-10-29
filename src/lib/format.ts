const TZ = 'Asia/Kolkata';
const d = (v: Date | string) => (v instanceof Date ? v : new Date(v));
export const fmtDateTime = (v: Date | string) => d(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
export const fmtDate = (v: Date | string) => d(v).toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
export const fmtTime = (v: Date | string) => d(v).toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true });
export const fmtMoney = (v: number | string) => { const n = Number(v); return n === 0 ? 'Free' : `₹${n.toFixed(n % 1 ? 2 : 0)}`; };
/** 'YYYY-MM-DD' of the instant in campus time (used by the calendar) */
export const dayKey = (v: Date | string) => d(v).toLocaleDateString('en-CA', { timeZone: TZ });
export const humanStatus = (s: string) => s.replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
/** value for <input type="datetime-local"> in campus time */
export const toLocalInput = (v: Date | string) => d(v).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16).replace(' ', 'T');
