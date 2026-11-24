import Link from 'next/link';
import { TopBar } from '@/components/TopBar';
import { currentParticipant } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export default async function Landing() {
  const me = await currentParticipant().catch(() => null);
  return (
    <>
      <TopBar right={me ? <Link href="/home" className="btn btn-ghost">My profile</Link> : <Link href="/signin" className="btn btn-ghost">Sign in</Link>} />
      <main className="page">
        <section className="hero">
          <div className="beeps" aria-hidden>
            <i className="dot" /><i className="dash" /><i className="dot" /><i className="dash" /><i className="dot" />
          </div>
          <h1>Learn Morse code <span className="grad">by ear</span></h1>
          <p>Hear the beeps, tap the letter, and pick up six letters in about 15 minutes. No experience needed.</p>
        </section>
        <div className="features">
          <div className="feature"><span className="ico" aria-hidden>🎧</span>Turn your sound on</div>
          <div className="feature"><span className="ico" aria-hidden>⚡</span>15–20 minutes</div>
          <div className="feature"><span className="ico" aria-hidden>📱</span>Phone or computer</div>
        </div>
        <div className="stack">
          {me ? (
            <Link href="/home" className="btn btn-primary btn-block">Continue as {me.displayName}</Link>
          ) : (
            <>
              <Link href="/start" className="btn btn-primary btn-block">Let’s go</Link>
              <Link href="/signin" className="btn btn-secondary btn-block">I’ve been here before</Link>
            </>
          )}
        </div>
        <p className="small muted center" style={{ marginTop: 28 }}>
          This is a research study about how people learn, for adults 18+. <Link href="/privacy">Privacy and your data</Link>.
          <br />
          Letter mapping and teaching approach inspired by <a href="https://github.com/AceCentre/morse-learn">Morse Learn</a> by Ace Centre
          (Apache-2.0). Not affiliated with Ace Centre or Google.
        </p>
      </main>
    </>
  );
}
