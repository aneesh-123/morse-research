import Link from 'next/link';
import { overview } from '@/lib/server/research';
import { mins, pct } from '@/components/research/format';

const STAGE_NAMES: Record<string, string> = {
  created: 'Opened, not started',
  consent_pending: 'Consent screen',
  audio_setup: 'Sound check',
  baseline_screening: 'Prior-knowledge question',
  diagnostic: 'Diagnostic',
  learning: 'Learning',
  profile_generation: 'Saving profile',
  final_assessment: 'Final test',
};

export default async function Overview({ searchParams }: { searchParams: Promise<{ test?: string }> }) {
  const sp = await searchParams;
  const includeTest = sp.test === '1';
  const o = await overview(includeTest);
  const started = o.diagnosticSkipped + o.diagnosticTaken;
  const stats: [string, string, string?][] = [
    ['Participants', String(o.participants)],
    ['Sessions', String(o.sessions)],
    ['Completed', String(o.completed)],
    ['In progress', String(o.incomplete)],
    ['Declined consent', String(o.declined)],
    ['Withdrawn / abandoned', String(o.withdrawnOrAbandoned)],
    ['Diagnostic skipped', `${pct(o.diagnosticSkipped, started)}`, `${o.diagnosticSkipped} of ${started} Day-1 sessions past screening`],
    ['Day-1 completion time', mins(o.medianCompletionMinutes), `median; mean ${mins(o.avgCompletionMinutes)}`],
    ['Final test accuracy', pct(o.finalCorrect, o.finalTotal), `${o.finalCorrect} of ${o.finalTotal} final-test trials, all participants pooled`],
  ];
  return (
    <>
      <div className="row">
        <h1 style={{ margin: 0 }}>Overview</h1>
        <span className="spacer" />
        <Link className="btn btn-ghost" href={includeTest ? '/research' : '/research?test=1'}>{includeTest ? 'Hide test participants' : 'Include test participants'}</Link>
      </div>
      <p className="muted">Pilot data. Counts describe the platform, not validated findings.</p>
      <div className="grid grid-4">
        {stats.map(([l, v, h]) => (
          <div className="stat" key={l}>
            <div className="label">{l}</div>
            <div className="value">{v}</div>
            {h && <div className="small muted">{h}</div>}
          </div>
        ))}
      </div>
      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>Where people drop out</h2>
          <p className="small muted">Day-1 sessions that reached each step. The bar shows the share of opened sessions.</p>
          <table className="t">
            <thead><tr><th>Step</th><th className="num">Sessions</th><th style={{ width: '40%' }}>Of opened</th></tr></thead>
            <tbody>
              {o.funnel.map((f, i) => {
                const base = o.funnel[0]!.sessions;
                const prev = i > 0 ? o.funnel[i - 1]!.sessions : f.sessions;
                const lost = prev - f.sessions;
                return (
                  <tr key={f.step}>
                    <td className="wrap">{f.step}{lost > 0 ? <span className="small muted"> (−{lost})</span> : null}</td>
                    <td className="num">{f.sessions}</td>
                    <td><div className="progress" aria-label={pct(f.sessions, base)}><div style={{ width: base ? `${(100 * f.sessions) / base}%` : 0 }} /></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2>Unfinished sessions</h2>
          <p className="small muted">Where unfinished Day-1 sessions stopped. “Inactive 24 h+” are still open but untouched for a day, so likely dropped out; they can still resume. Use the session status column in exports to include or exclude them.</p>
          {o.unfinished.length === 0 ? <p className="muted" style={{ margin: 0 }}>None.</p> : (
            <table className="t">
              <thead><tr><th>Stopped at</th><th className="num">Sessions</th><th className="num">Inactive 24 h+</th><th className="num">Withdrawn / closed</th></tr></thead>
              <tbody>{o.unfinished.map((u) => <tr key={u.stage}><td>{STAGE_NAMES[u.stage] ?? u.stage}</td><td className="num">{u.sessions}</td><td className="num">{u.inactive24h}</td><td className="num">{u.withdrawn}</td></tr>)}</tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h2>Devices</h2>
          <table className="t"><thead><tr><th>Device</th><th className="num">Sessions</th><th className="num">Completed</th></tr></thead>
            <tbody>{o.devices.map((d) => <tr key={d.device}><td>{d.device}</td><td className="num">{d.sessions}</td><td className="num">{d.completed}</td></tr>)}</tbody>
          </table>
        </section>
        <section className="card">
          <h2>Protocol versions</h2>
          <table className="t"><thead><tr><th>Protocol</th><th className="num">Sessions</th><th className="num">Completed</th></tr></thead>
            <tbody>{o.protocols.map((d) => <tr key={d.protocol}><td>{d.protocol}</td><td className="num">{d.sessions}</td><td className="num">{d.completed}</td></tr>)}</tbody>
          </table>
        </section>
      </div>
    </>
  );
}
