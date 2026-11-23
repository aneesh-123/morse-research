import Link from 'next/link';
import { requireResearcherPage } from '@/lib/server/researchers';
import { LogoutButton } from './LogoutButton';

export const dynamic = 'force-dynamic';

export default async function ResearchLayout({ children }: { children: React.ReactNode }) {
  const r = await requireResearcherPage();
  return (
    <>
      <nav className="r-nav" aria-label="Research dashboard">
        <Link href="/research" className="brand"><span className="brand-mark">·−</span> Research</Link>
        <Link href="/research">Overview</Link>
        <Link href="/research/participants">Participants</Link>
        <Link href="/research/analysis">Aggregate analysis</Link>
        <Link href="/research/export">Exports</Link>
        <Link href="/research/settings">Study configuration</Link>
        <span className="spacer" />
        <span className="small muted" style={{ alignSelf: 'center' }}>{r.email}</span>
        <LogoutButton />
      </nav>
      <main className="page-wide">{children}</main>
    </>
  );
}
