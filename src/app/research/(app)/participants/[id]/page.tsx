import Link from 'next/link';
import { notFound } from 'next/navigation';
import { participantDetail } from '@/lib/server/research';
import { dt, pct } from '@/components/research/format';
import { ParticipantActions } from './ParticipantActions';

export default async function ParticipantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await participantDetail(id);
  if (!d) notFound();
  const p = d.participant;
  return (
    <>
      <p className="small"><Link href="/research/participants">← Participants</Link></p>
      <h1>{p.public_code} {p.is_test && <span className="badge warn">test</span>}</h1>
      <section className="card">
        <dl className="kv">
          <dt>Participant ID</dt><dd><code>{p.id}</code></dd>
          <dt>Nickname</dt><dd>{p.display_name}</dd>
          <dt>Created</dt><dd>{dt(p.created_at)}</dd>
          <dt>Last active</dt><dd>{dt(p.last_active_at)}</dd>
          <dt>Email on file</dt><dd>{p.has_email ? (p.email_verified ? 'yes, verified' : 'yes, not verified') : 'no (recovery code only)'}</dd>
          <dt>Account status</dt><dd>{p.status}</dd>
        </dl>
      </section>
      <section className="card">
        <h2>Consent records</h2>
        {d.consents.length === 0 ? <p className="muted">None.</p> : (
          <table className="t"><thead><tr><th>When</th><th>Version</th><th>Decision</th><th>Session</th></tr></thead>
            <tbody>{d.consents.map((c) => <tr key={c.session_id}><td>{dt(c.created_at)}</td><td>{c.consent_version}</td><td>{c.decision}</td><td><Link href={`/research/sessions/${c.session_id}`}>{c.session_id.slice(0, 8)}</Link></td></tr>)}</tbody>
          </table>
        )}
      </section>
      <section className="card">
        <h2>Session history</h2>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Session</th><th>Type</th><th>Protocol</th><th>Status / stage</th><th>Started</th><th>Completed</th><th>Device</th><th>Baseline</th><th className="num">Prior</th><th className="num">Diagnostic</th><th className="num">Learning</th><th className="num">Test</th></tr></thead>
            <tbody>
              {d.sessions.map((s) => {
                const sum = (ph: string) => { const x = d.summaries.find((y) => y.session_id === s.id && y.phase === ph); return x ? `${x.c}/${x.n} (${pct(x.c, x.n)})` : '—'; };
                return (
                  <tr key={s.id}>
                    <td><Link href={`/research/sessions/${s.id}`}>{s.id.slice(0, 8)}</Link>{s.parent_session_id && <div className="small muted">follows {s.parent_session_id.slice(0, 8)}</div>}</td>
                    <td>{s.study_type}</td><td>{s.protocol_version}</td><td>{s.status}{s.status === 'in_progress' ? ` · ${s.stage}` : ''}</td>
                    <td>{dt(s.created_at)}</td><td>{dt(s.completed_at)}</td><td>{s.device_category ?? '—'} {s.browser_family ? `· ${s.browser_family}` : ''}</td>
                    <td>{s.baseline_status ?? '—'}</td><td className="num">{s.prior_knowledge_rating ?? '—'}</td>
                    <td className="num">{sum('diagnostic')}</td><td className="num">{sum('learning')}</td><td className="num">{s.study_type === 'day1_learning' ? sum('final') : sum('retention')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card"><h2>Export</h2><a className="btn btn-secondary" href={`/api/research/export?dataset=participant_history&participant=${p.id}`}>Download full history (JSON)</a></section>
      <ParticipantActions id={p.id} isTest={p.is_test} />
    </>
  );
}
