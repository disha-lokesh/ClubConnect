import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { HOME } from '@/lib/auth';

export default async function Landing() {
  const s = await getSession().catch(() => null);
  if (s) redirect(HOME[s.role]);
  return (
    <div className="container">
      <div className="hero">
        <h1>Every club event on campus, in one place.</h1>
        <p>Clubs submit events, campus administrators approve them, and students discover, register and track everything without chasing chat groups and spreadsheets. Venue clashes are caught before they happen.</p>
        <div className="row" style={{ justifyContent: 'center' }}><Link className="btn primary" href="/login">Log in</Link><Link className="btn" href="/register">Create a student account</Link></div>
      </div>
      <div className="grid g3">
        <div className="card"><h3>For students</h3><p className="muted">Browse the calendar, search by club, category, date or fee, register in one click and get notified when anything changes.</p></div>
        <div className="card"><h3>For clubs</h3><p className="muted">Draft events, submit them for approval, manage registrations and attendance, and post announcements.</p></div>
        <div className="card"><h3>For campus administrators</h3><p className="muted">Review submissions with conflict warnings, manage venues and clubs, and see participation reports.</p></div>
      </div>
    </div>
  );
}
