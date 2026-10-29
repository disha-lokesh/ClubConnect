import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'ClubConnect: campus club events', description: 'Discover, approve and register for student club events in one place.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
