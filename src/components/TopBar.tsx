import Link from 'next/link';

export function Logo() {
  return (
    <span className="logo" aria-hidden>
      <i /><i /><i />
    </span>
  );
}

export function TopBar({ right }: { right?: React.ReactNode }) {
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <Logo /> Morse Study
      </Link>
      <div>{right}</div>
    </header>
  );
}
