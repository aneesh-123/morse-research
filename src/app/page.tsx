import Link from 'next/link';
import { TopBar } from '@/components/TopBar';
import { currentParticipant } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export default async function Landing() {
  const me = await currentParticipant().catch(() => null);
  return (
    <>
      <TopBar right={me ? <Link href="/home" className="btn btn-ghost">My profile</Link> : null} />
      <main className="page">
        <section className="card">
          <h1>Learn six Morse code letters by ear</h1>
          <p>
            This is a research study about how people learn a new skill, and whether a computer can tell what someone has
            learned from the way they practise.
          </p>
          <p className="muted">
            You will hear short beeps and pick the letter you hear. It takes about 15 to 20 minutes, works on a phone or a
            computer, and needs sound. Open to adults (18+).
          </p>
          <div className="stack">
            {me ? (
              <Link href="/home" className="btn btn-primary btn-block">Continue as {me.displayName}</Link>
            ) : (
              <>
                <Link href="/start" className="btn btn-primary btn-block">Create your learner profile</Link>
                <Link href="/signin" className="btn btn-secondary btn-block">I already have a profile</Link>
              </>
            )}
          </div>
        </section>
        <section className="card card-tight small muted">
          <p>
            Your profile lets you come back later for follow-up sessions. We only ask for a nickname; email is optional.
            Read about <Link href="/privacy">what we collect and how to delete it</Link>.
          </p>
          <p style={{ margin: 0 }}>
            Letter mapping and teaching approach inspired by <a href="https://github.com/AceCentre/morse-learn">Morse Learn</a> by
            Ace Centre (Apache-2.0). Not affiliated with Ace Centre or Google.
          </p>
        </section>
      </main>
    </>
  );
}
