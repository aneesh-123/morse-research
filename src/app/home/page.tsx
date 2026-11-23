import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { currentParticipant } from '@/lib/server/http';
import { participantOverview } from '@/lib/server/experiment';
import { HomeActions, StartButton, SignOutButton } from './HomeClient';

export const dynamic = 'force-dynamic';

const STAGE_TEXT: Record<string, string> = {
  consent_pending: 'Not started',
  audio_setup: 'Sound check',
  baseline_screening: 'Getting started',
  diagnostic: 'Quick check',
  learning: 'Learning',
  profile_generation: 'Learning finished',
  final_assessment: 'Final test',
  retention_screening: 'Getting started',
  retention_test: 'Follow-up check',
  completed: 'Completed',
  declined: 'Not taken',
  withdrawn: 'Stopped',
  abandoned: 'Closed',
};

const TITLES: Record<string, string> = { day1_learning: 'Learning session', delayed_retention: 'Follow-up check' };

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function HomePage() {
  const me = await currentParticipant();
  if (!me) redirect('/signin');
  const ov = await participantOverview(me.id);
  const completed = ov.sessions.filter((s) => s.status === 'completed');

  return (
    <>
      <TopBar right={<SignOutButton />} />
      <main className="page">
        <h1>Hi, {ov.displayName}</h1>
        <p className="muted small">
          Participant code <strong>{ov.publicCode}</strong>
          {ov.lastParticipation ? <> · last took part {fmt(ov.lastParticipation)}</> : null}
        </p>

        {ov.incompleteSession ? (
          <section className="card">
            <h2>You have a session in progress</h2>
            <p className="muted">
              {TITLES[ov.incompleteSession.studyType]}: {STAGE_TEXT[ov.incompleteSession.stage] ?? ov.incompleteSession.stage}. Your answers so far are
              saved and you will continue where you left off.
            </p>
            <Link className="btn btn-primary btn-block" href={`/study/${ov.incompleteSession.sessionId}`}>Resume session</Link>
          </section>
        ) : ov.available.length ? (
          ov.available.map((a) => (
            <section className="card" key={a.studyType}>
              <span className="badge accent">Available now</span>
              <h2 style={{ marginTop: 8 }}>{a.title}</h2>
              <p className="muted">About {a.minutes[0]}–{a.minutes[1]} minutes. You will need sound.</p>
              <StartButton studyType={a.studyType} />
            </section>
          ))
        ) : (
          <section className="card">
            <h2>{completed.length ? 'Thank you for taking part' : 'No session available'}</h2>
            <p className="muted">
              {ov.enrollmentMessage ??
                (ov.upcoming.length
                  ? `Your next session (${ov.upcoming[0]!.title.toLowerCase()}) opens ${fmt(ov.upcoming[0]!.availableAt)}.`
                  : completed.length
                    ? 'There is nothing else to do right now. Future follow-up sessions may become available here; come back with this profile.'
                    : 'Please check back later.')}
            </p>
          </section>
        )}

        <section className="card">
          <h2>Your sessions</h2>
          {ov.sessions.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>None yet.</p>
          ) : (
            <ul className="list">
              {ov.sessions.map((s) => (
                <li key={s.sessionId} className="row">
                  <div>
                    <strong>{TITLES[s.studyType]}</strong>
                    <div className="small muted">Started {fmt(s.createdAt)}{s.completedAt ? ` · finished ${fmt(s.completedAt)}` : ''}</div>
                  </div>
                  <span className="spacer" />
                  <span className={`badge ${s.status === 'completed' ? 'good' : s.status === 'in_progress' ? 'accent' : ''}`}>{STAGE_TEXT[s.stage] ?? s.stage}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <HomeActions email={ov.email} emailVerified={ov.emailVerified} emailAvailable={ov.emailAvailable} />
      </main>
    </>
  );
}
