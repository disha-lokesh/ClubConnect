'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function NavLinks({ items }: { items: { href: string; label: string; badge?: number; exact?: boolean }[] }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {items.map(i => {
        const active = i.exact ? path === i.href : path === i.href || path.startsWith(i.href + '/');
        return <Link key={i.href} href={i.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>{i.label}{!!i.badge && <span className="pill">{i.badge}</span>}</Link>;
      })}
    </nav>
  );
}
