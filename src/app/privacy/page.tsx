import { TopBar } from '@/components/TopBar';
import { getSettings } from '@/lib/server/settings';
import { contactConfigured } from '@/lib/protocol/consent';

export const dynamic = 'force-dynamic';

export default async function PrivacyPage() {
  const s = await getSettings().catch(() => null);
  const c = s?.contact;
  return (
    <>
      <TopBar />
      <main className="page">
        <h1>Privacy and your data</h1>
        <section className="card">
          <h2>What we collect</h2>
          <p>
            After you agree to take part: your answers, response times, how often you replay sounds, taps and clicks on study
            buttons, counts (not contents) of mouse and keyboard activity on the study page, when the page is hidden or loses
            focus, idle periods, and your device type and browser family.
          </p>
          <p>
            We do not record your microphone, anything you type outside the study controls, your browsing history, or detailed
            mouse movements. Before you agree, nothing about your activity is recorded.
          </p>
          <h2>Who can see it</h2>
          <p>
            Only the research team, through a password-protected dashboard. Research data is linked to a random participant ID.
            Your email (if you gave one) is stored separately and is never included in research data exports; your nickname is left out of exports unless a researcher specifically includes it.
          </p>
          <h2>How long we keep it</h2>
          <p>{c?.dataRetention}</p>
          <h2>Deleting your data</h2>
          <p>
            Sign in, open your profile page and choose “Delete my data and leave the study”. This deletes your profile and every
            study record linked to it straight away.
            {c && contactConfigured(c) ? <> You can also ask {c.researcherName} at <a href={`mailto:${c.contactEmail}`}>{c.contactEmail}</a>.</> : null}
          </p>
          <h2>Cookies</h2>
          <p style={{ margin: 0 }}>
            One cookie keeps you signed in to your learner profile. There are no advertising or analytics cookies. Unsent study
            events are kept briefly in your browser&apos;s storage until they reach our server.
          </p>
        </section>
      </main>
    </>
  );
}
