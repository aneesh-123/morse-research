import Link from 'next/link';

export function TopBar({ right }: { right?: React.ReactNode }) {
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <span className="brand-mark" aria-hidden>·−</span> Morse Learning Study
      </Link>
      <div>{right}</div>
    </header>
  );
}
