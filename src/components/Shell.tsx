import Link from 'next/link';
import NavLinks from './NavLinks';
import LogoutButton from './LogoutButton';
import type { Session } from '@/lib/db';

const LABEL = { STUDENT: 'Student', CLUB_ADMIN: 'Club admin', CAMPUS_ADMIN: 'Campus admin' } as const;
export default function Shell({ s, nav, home, children }: { s: Session; nav: { href: string; label: string; badge?: number; exact?: boolean }[]; home: string; children: React.ReactNode }) {
  const notifications = nav.find(i => i.label === 'Notifications');
  const profile = nav.find(i => i.label === 'Profile');
  return (
    <div className="app-shell">
      <header className="topbar"><div className="topbar-in">
        <Link href={home} className="brand">Club<span>Connect</span></Link><span className="rolechip">{LABEL[s.role]}</span>
        <div className="topbar-actions">
          {notifications && <details className="utility-popover">
            <summary className="icon-btn" aria-label="Notifications" title="Notifications">
              <span aria-hidden="true">🔔</span>{!!notifications.badge && <span className="pill">{notifications.badge}</span>}
            </summary>
            <div className="popover-card"><strong>Notifications</strong><Link href={notifications.href}>View all notifications</Link></div>
          </details>}
          {profile && <Link href={profile.href} className="icon-btn" aria-label="Profile" title="Profile"><span aria-hidden="true">●</span></Link>}
          <Link href={profile ? `${profile.href}?section=settings` : home} className="icon-btn" aria-label="Settings" title="Settings"><span aria-hidden="true">⚙</span></Link>
          <span className="small muted user-name">{s.name}</span><LogoutButton />
        </div>
      </div></header>
      <aside className="sidebar">
        <NavLinks items={nav} />
      </aside>
      <main className="container">{children}</main>
    </div>
  );
}
