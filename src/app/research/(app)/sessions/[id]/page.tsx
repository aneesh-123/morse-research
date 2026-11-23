import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sessionDetail, type ResponseRow } from '@/lib/server/research';
import { CATEGORY_BADGE, dt, ms, pctv } from '@/components/research/format';
import { CharacterStrips, ConfusionMatrix, LatencyChart, TrajectoryChart, type TrialPoint } from '@/components/research/Charts';
import { getProtocol } from '@/lib/protocol/protocols';
import { SessionActions } from './SessionActions';

function toPoints(rows: ResponseRow[]): TrialPoint[] {
  return rows.map((r) => ({
    index: r.phase_index, correct: r.is_correct, idk: r.is_idk, target: r.target, response: r.response, rtMs: r.rt_ms === null ? null : Number(r.rt_ms),
    interrupted: r.interrupted, replays: r.replay_count, block: r.block,
  }));
}

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await sessionDetail(id);
  if (!d) notFound();
  const s = d.session;
  const protocol = getProtocol(s.protocol_version);
  const chars = protocol.characters;
  const byPhase = (ph: string) => d.responses.filter((r) => r.phase === ph);
  const diag = byPhase('diagnostic');
  const learning = byPhase('learning');
  const testPhase = s.study_type === 'day1_learning' ? 'final' : 'retention';
  const test = byPhase(testPhase);
  const intros = d.schedule.filter((r) => r.phase === 'learning' && r.introduce_before.length).map((r) => ({ index: r.position - (d.schedule.find((x) => x.phase === 'learning')?.position ?? 1) + 1, label: `+${r.introduce_before.join(',')}` }));
  const evaluation = d.evaluations[0]?.result ?? null;
  const evByChar = new Map(evaluation?.characters.map((c) => [c.character, c]) ?? []);
  const eventCounts = d.events.reduce<Record<string, number>>((a, e) => ((a[e.type] = (a[e.type] ?? 0) + 1), a), {});
  const idleMs = d.events.filter((e) => e.type === 'idle_end').reduce((sum, e) => sum + Number(e.payload.idleMs ?? 0), 0);
  const learnTimes = d.events.filter((e) => e.trial_position !== null && learning.some((r) => r.position === e.trial_position));
  const learningSpanMin = learnTimes.length ? (Math.max(...learnTimes.map((e) => e.client_epoch_ms)) - Math.min(...learnTimes.map((e) => e.client_epoch_ms))) / 60000 : null;
  const screens = d.events.filter((e) => e.type === 'screen_exit');
  const screenTotals = screens.reduce<Record<string, { ms: number; n: number; taps: number; clicks: number; moves: number; keys: number }>>((a, e) => {
    const k = e.screen ?? '?';
    const t = (a[k] ??= { ms: 0, n: 0, taps: 0, clicks: 0, moves: 0, keys: 0 });
    t.ms += Number(e.payload.durationMs ?? 0); t.n++; t.taps += Number(e.payload.taps ?? 0); t.clicks += Number(e.payload.clicks ?? 0);
    t.moves += Number(e.payload.mouseMoves ?? 0); t.keys += Number(e.payload.keyPresses ?? 0);
    return a;
  }, {});
  const conf = (rows: ResponseRow[]) => rows.map((r) => ({ target: r.target, response: r.is_idk ? null : r.response, n: 1 }));

  return (
    <>
      <p className="small"><Link href={`/research/participants/${s.participant_id}`}>← {s.public_code}</Link></p>
      <h1>Session {s.id.slice(0, 8)} <span className="badge">{s.status}</span></h1>
      <section className="card">
        <dl className="kv">
          <dt>Session ID</dt><dd><code>{s.id}</code></dd>
          <dt>Participant</dt><dd><Link href={`/research/participants/${s.participant_id}`}>{s.public_code}</Link> ({s.display_name})</dd>
          <dt>Study / protocol</dt><dd>{s.study_type} · {s.protocol_version}</dd>
          {s.parent_session_id && <><dt>Follows session</dt><dd><Link href={`/research/sessions/${s.parent_session_id}`}>{s.parent_session_id.slice(0, 8)}</Link> · {s.hours_since_parent?.toFixed(1)} h later · practised since: {String(s.retention_answers?.practicedSince ?? '—')}</dd></>}
          <dt>Stage</dt><dd>{s.stage}{s.end_reason ? ` (${s.end_reason})` : ''}{s.current_position ? ` · next position ${s.current_position}/${s.schedule_length}` : ''}</dd>
          <dt>Randomisation seed</dt><dd><code>{s.seed}</code></dd>
          <dt>Created / consented / completed</dt><dd>{dt(s.created_at)} · {dt(s.consented_at)} · {dt(s.completed_at)}</dd>
          <dt>Consent</dt><dd>{d.consent ? `${d.consent.decision} · ${d.consent.consent_version} · ${dt(d.consent.created_at)} · text sha256 ${d.consent.consent_text_sha256.slice(0, 12)}…` : 'none'}</dd>
          <dt>Device</dt><dd>{s.device_category ?? '—'} · {s.browser_family ?? '—'} · {s.os_family ?? '—'}{s.client_info ? ` · ${s.client_info.viewportWidth}×${s.client_info.viewportHeight} · touch ${String(s.client_info.touch)} · audio ${s.client_info.audioSampleRate ?? '?'} Hz, output latency ${s.client_info.audioOutputLatencyMs ?? '?'} ms` : ''}</dd>
          <dt>Baseline</dt><dd>{s.baseline_status ?? '—'} · self-rating {s.prior_knowledge_rating ?? '—'}/10{diag.length ? ` · diagnostic ${diag.filter((r) => r.is_correct).length}/${diag.length} correct, ${diag.filter((r) => r.is_idk).length} “don’t know”` : ''}</dd>
          <dt>Resumes / interruptions</dt><dd>{s.resume_count} page loads resumed · {d.responses.filter((r) => r.interrupted).length} interrupted trials · {d.responses.filter((r) => r.restarted).length} restarted</dd>
          <dt>Stage history</dt><dd className="small">{s.stage_history.map((h) => `${h.to} ${h.at.slice(11, 19)}`).join(' → ')}</dd>
        </dl>
        <SessionActions id={s.id} canAbandon={s.status === 'in_progress'} canReevaluate={s.status === 'completed'} />
      </section>

      {learning.length > 0 && (
        <section className="card">
          <h2>Learning trajectory</h2>
          <TrajectoryChart points={toPoints(learning)} introductions={intros} title="Correctness by learning trial with rolling accuracy" />
          <h3 style={{ marginTop: 16 }}>Response latency and replays</h3>
          <LatencyChart points={toPoints(learning)} title="Response latency by learning trial" />
          <h3 style={{ marginTop: 16 }}>Per-letter outcomes over time</h3>
          <CharacterStrips points={toPoints(learning)} characters={chars} />
        </section>
      )}

      {d.profile && (
        <section className="card">
          <h2>Knowledge profile vs. independent test</h2>
          <p className="small muted">
            Estimate frozen {dt(d.profile.created_at)} by {d.profile.estimator_version} from {d.profile.input_observations} observations up to position {d.profile.input_cutoff_position}
            {s.parent_session_id ? ' (Day-1 profile)' : ''}; input hash {d.profile.input_sha256.slice(0, 12)}…. Measured columns come from the {testPhase === 'final' ? 'final test' : 'follow-up test'} and never feed back into the estimate.
          </p>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Letter</th><th>Estimate (frozen)</th><th className="num">Intro block</th><th className="num">Learning n</th><th className="num">Accuracy</th><th className="num">Last 3</th><th className="num">95% interval</th><th className="num">Chance</th><th>Top confusion</th><th className="num">Replays/trial</th><th className="num">Median RT</th><th className="num">Predicted</th><th className="num">Measured</th><th>Explanation</th>
                </tr>
              </thead>
              <tbody>
                {d.profile.profile.characters.map((c) => {
                  const e = evByChar.get(c.character);
                  const m = c.learning;
                  return (
                    <tr key={c.character}>
                      <th>{c.character}</th>
                      <td><span className={`badge ${CATEGORY_BADGE[c.category] ?? ''}`}>{c.categoryLabel}</span></td>
                      <td className="num">{c.introducedBlock ?? '—'}</td>
                      <td className="num">{m.n}</td>
                      <td className="num">{m.n ? `${m.correct}/${m.n}` : '—'}</td>
                      <td className="num">{m.recentN ? `${m.recentCorrect}/${m.recentN}` : '—'}</td>
                      <td className="num">{m.wilson95 ? `${pctv(m.wilson95.lower)}–${pctv(m.wilson95.upper)}` : '—'}</td>
                      <td className="num">{pctv(m.chanceRate)}</td>
                      <td>{m.topConfusion ? `${m.topConfusion.character} ×${m.topConfusion.count}` : '—'}</td>
                      <td className="num">{m.replayRate === null ? '—' : m.replayRate.toFixed(2)}</td>
                      <td className="num">{ms(m.latencyAll?.medianMs)}</td>
                      <td className="num">{pctv(c.predictedFinalAccuracy)}</td>
                      <td className="num">{e && e.observedN ? `${e.observedCorrect}/${e.observedN}${e.observedIdk ? ` (${e.observedIdk} ?)` : ''}` : 'not yet'}</td>
                      <td className="wrap small">{c.explanation}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="small" style={{ marginTop: 10 }}>{d.profile.profile.summary.text}</p>
          <ul className="small muted">{d.profile.profile.summary.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          {evaluation && (
            <>
              <h3>Evaluation ({d.evaluations[0]!.kind}, {evaluation.evaluationVersion})</h3>
              <dl className="kv">
                <dt>Measured accuracy</dt><dd>{evaluation.overall.observedCorrect}/{evaluation.overall.observedN} ({pctv(evaluation.overall.observedAccuracy)})</dd>
                <dt>Mean absolute error (per letter)</dt><dd>{evaluation.overall.meanAbsoluteError?.toFixed(3) ?? '—'}</dd>
                <dt>Brier score (per trial)</dt><dd>{evaluation.overall.brier?.toFixed(3) ?? '—'}</dd>
                <dt>Spearman (6 letters)</dt><dd>{evaluation.overall.spearman?.toFixed(2) ?? 'undefined (ties)'}</dd>
                <dt>Measured accuracy by estimate</dt><dd>{Object.entries(evaluation.overall.byCategory).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v.observedCorrect}/${v.observedN}`).join(' · ')}</dd>
              </dl>
              <div className="notice small">{evaluation.caveats.join(' ')}</div>
            </>
          )}
        </section>
      )}

      <div className="grid grid-2">
        {learning.length > 0 && <section className="card"><h2>Confusions during learning</h2><ConfusionMatrix rows={conf(learning)} characters={chars} caption="Learning confusion matrix" /></section>}
        {test.length > 0 && <section className="card"><h2>Confusions on the {testPhase === 'final' ? 'final test' : 'follow-up test'}</h2><ConfusionMatrix rows={conf(test)} characters={chars} caption="Test confusion matrix" /></section>}
        {diag.length > 0 && <section className="card"><h2>Diagnostic answers</h2><ConfusionMatrix rows={conf(diag)} characters={chars} caption="Diagnostic confusion matrix" /></section>}
      </div>

      <section className="card">
        <h2>Behaviour</h2>
        <p className="small muted">Engagement proxies, not validated psychological measures. Idle = no pointer, touch or key activity for {protocol.timing.idleThresholdMs / 1000} s.</p>
        <div className="grid grid-4">
          <div className="stat"><div className="label">Learning span</div><div className="value">{learningSpanMin === null ? '—' : `${learningSpanMin.toFixed(1)} min`}</div></div>
          <div className="stat"><div className="label">Replays (learning)</div><div className="value">{learning.reduce((a, r) => a + r.replay_count, 0)}</div></div>
          <div className="stat"><div className="label">Idle time</div><div className="value">{(idleMs / 1000).toFixed(0)} s</div></div>
          <div className="stat"><div className="label">Tab hidden events</div><div className="value">{eventCounts.visibility_hidden ?? 0}</div></div>
        </div>
        <h3 style={{ marginTop: 16 }}>Time and activity by screen</h3>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Screen</th><th className="num">Visits</th><th className="num">Total time</th><th className="num">Taps</th><th className="num">Mouse clicks</th><th className="num">Mouse moves</th><th className="num">Control key presses</th></tr></thead>
            <tbody>{Object.entries(screenTotals).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v.n}</td><td className="num">{(v.ms / 1000).toFixed(1)} s</td><td className="num">{v.taps}</td><td className="num">{v.clicks}</td><td className="num">{v.moves}</td><td className="num">{v.keys}</td></tr>)}</tbody>
          </table>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary>Event counts by type</summary>
          <table className="t"><tbody>{Object.entries(eventCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v}</td></tr>)}</tbody></table>
        </details>
      </section>

      <section className="card">
        <h2>All trials ({d.responses.length} of {d.schedule.length} scheduled)</h2>
        <div className="table-wrap" style={{ maxHeight: 560 }}>
          <table className="t">
            <thead><tr><th className="num">Pos</th><th>Phase</th><th className="num">#</th><th className="num">Block</th><th>Target</th><th>Answer</th><th>OK</th><th className="num">Options</th><th className="num">RT</th><th className="num">Replays</th><th className="num">Exposure</th><th>Flags</th><th>Saved</th></tr></thead>
            <tbody>
              {d.schedule.map((sch) => {
                const r = d.responses.find((x) => x.position === sch.position);
                return (
                  <tr key={sch.position} style={r ? undefined : { opacity: 0.5 }}>
                    <td className="num">{sch.position}</td><td>{sch.phase}</td><td className="num">{r?.phase_index ?? ''}</td><td className="num">{sch.block ?? ''}</td>
                    <td>{sch.target}{sch.introduce_before.length ? <span className="small muted"> (intro {sch.introduce_before.join(',')})</span> : null}</td>
                    <td>{r ? (r.is_idk ? '?' : r.response) : '—'}</td>
                    <td>{r ? (r.is_correct ? '✓' : '✗') : ''}</td>
                    <td className="num">{sch.options.length}</td>
                    <td className="num">{r ? ms(r.rt_ms) : ''}</td>
                    <td className="num">{r?.replay_count ?? ''}</td>
                    <td className="num">{r?.cumulative_target_exposures ?? ''}</td>
                    <td className="small">{r?.timing_flags?.filter((f) => f !== 'no_observed_playback_end' || !r.playback_end_observed_ms).join(', ')}</td>
                    <td className="small">{r ? dt(r.received_at) : 'not answered'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <details>
          <summary>Event log ({d.events.length})</summary>
          <div className="table-wrap" style={{ maxHeight: 560, marginTop: 8 }}>
            <table className="t">
              <thead><tr><th>Client time</th><th>Load</th><th className="num">Seq</th><th>Type</th><th>Screen</th><th className="num">Trial</th><th>Payload</th></tr></thead>
              <tbody>{d.events.slice(0, 3000).map((e) => <tr key={e.id}><td>{new Date(e.client_epoch_ms).toISOString().slice(11, 23)}</td><td>{e.client_load_id.slice(0, 6)}</td><td className="num">{e.seq}</td><td>{e.type}</td><td>{e.screen ?? ''}</td><td className="num">{e.trial_position ?? ''}</td><td className="small wrap"><code>{JSON.stringify(e.payload)}</code></td></tr>)}</tbody>
            </table>
          </div>
        </details>
      </section>
    </>
  );
}
