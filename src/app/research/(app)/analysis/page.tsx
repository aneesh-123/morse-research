import Link from 'next/link';
import { aggregate } from '@/lib/server/research';
import { ConfusionMatrix, Bar } from '@/components/research/Charts';
import { DAY1_V1, introductionBlock } from '@/lib/protocol/protocols';
import { generateDay1Schedule } from '@/lib/protocol/schedule';
import { CATEGORY_LABELS, EVIDENCE_CATEGORIES } from '@/lib/estimator/config';
import { ms, pct, pctv } from '@/components/research/format';

export default async function Analysis({ searchParams }: { searchParams: Promise<{ phase?: string; test?: string }> }) {
  const sp = await searchParams;
  const phase = ['learning', 'final', 'diagnostic', 'retention'].includes(sp.phase ?? '') ? (sp.phase as string) : 'final';
  const includeTest = sp.test === '1';
  const a = await aggregate(includeTest);
  const chars = DAY1_V1.characters;
  const intro = introductionBlock(DAY1_V1);
  const exposures: Record<string, number> = {};
  generateDay1Schedule(DAY1_V1, 'exposure-count', false).filter((t) => t.phase === 'learning').forEach((t) => (exposures[t.target] = (exposures[t.target] ?? 0) + 1));
  const cell = (c: string, ph: string) => a.byChar.find((x) => x.target === c && x.phase === ph);

  // Pool frozen-estimate categories vs measured accuracy across Day-1 evaluations.
  const day1 = a.evals.filter((e) => e.kind === 'final_assessment');
  const catPool: Record<string, { c: number; n: number; letters: number }> = {};
  const scatter: { p: number; o: number; ch: string }[] = [];
  for (const e of day1) {
    for (const c of e.result.characters) {
      const b = (catPool[c.category] ??= { c: 0, n: 0, letters: 0 });
      b.c += c.observedCorrect; b.n += c.observedN; b.letters++;
      if (c.predictedAccuracy !== null && c.observedAccuracy !== null) scatter.push({ p: c.predictedAccuracy, o: c.observedAccuracy, ch: c.character });
    }
  }
  const mae = day1.map((e) => e.result.overall.meanAbsoluteError).filter((x): x is number => x !== null);
  const brier = day1.map((e) => e.result.overall.brier).filter((x): x is number => x !== null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  const rn = (v: string | undefined) => Number(v ?? 0);
  const readinessRows: { label: string; n: number; target?: number }[] = [
    { label: 'Completed sessions', n: rn(a.readiness?.completed), target: 30 },
    { label: 'Distinct participants', n: rn(a.readiness?.participants), target: 30 },
    { label: 'With frozen profile', n: rn(a.readiness?.profiled) },
    { label: 'With stored evaluation', n: rn(a.readiness?.evaluated), target: 30 },
    { label: 'Took the diagnostic (H4)', n: rn(a.readiness?.with_diagnostic), target: 15 },
    { label: 'Skipped the diagnostic (H4)', n: rn(a.readiness?.skipped_diagnostic), target: 15 },
    { label: 'With behavioural events (H2)', n: rn(a.readiness?.with_events), target: 30 },
    { label: 'No interrupted final-test trials', n: rn(a.readiness?.clean_final) },
    { label: 'Device categories represented', n: rn(a.readiness?.devices), target: 2 },
  ];

  const W = 320, H = 320, pad = 36;
  const sx = (v: number) => pad + v * (W - pad - 10);
  const sy = (v: number) => H - pad - v * (H - pad - 10);

  return (
    <>
      <div className="row">
        <h1 style={{ margin: 0 }}>Aggregate analysis</h1>
        <span className="spacer" />
        <Link className="btn btn-ghost" href={`/research/analysis?phase=${phase}${includeTest ? '' : '&test=1'}`}>{includeTest ? 'Hide test participants' : 'Include test participants'}</Link>
      </div>
      <p className="muted">Descriptive pilot summaries pooled across participants. They are not validated findings; use exported data with held-out participants for inference.</p>

      <section className="card">
        <h2>Per-letter performance and exposure</h2>
        <p className="small muted">Exposure is fixed by protocol day1-v1: later letters get fewer learning trials, so compare letters with that in mind.</p>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Letter</th><th className="num">Intro block</th><th className="num">Learning trials / person</th><th>Diagnostic</th><th>Learning</th><th>Final test</th><th className="num">Final median RT</th><th className="num">Learning replays</th></tr></thead>
            <tbody>
              {chars.map((c) => {
                const d = cell(c, 'diagnostic'), l = cell(c, 'learning'), f = cell(c, 'final');
                return (
                  <tr key={c}>
                    <th>{c}</th><td className="num">{intro[c]}</td><td className="num">{exposures[c]}</td>
                    <td>{d ? <Bar value={Number(d.c) / Number(d.n)} label={`${pct(Number(d.c), Number(d.n))} (n=${d.n})`} /> : '—'}</td>
                    <td>{l ? <Bar value={Number(l.c) / Number(l.n)} label={`${pct(Number(l.c), Number(l.n))} (n=${l.n})`} /> : '—'}</td>
                    <td>{f ? <Bar value={Number(f.c) / Number(f.n)} label={`${pct(Number(f.c), Number(f.n))} (n=${f.n})`} /> : '—'}</td>
                    <td className="num">{ms(f?.median_rt)}</td><td className="num">{l?.replays ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>Confusion matrix (all participants)</h2>
          <span className="spacer" />
          {['diagnostic', 'learning', 'final', 'retention'].map((p) => (
            <Link key={p} className={`btn ${p === phase ? 'btn-primary' : 'btn-secondary'}`} style={{ minHeight: 36, padding: '6px 12px' }} href={`/research/analysis?phase=${p}${includeTest ? '&test=1' : ''}`}>{p}</Link>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <ConfusionMatrix rows={a.confusion.filter((r) => r.phase === phase).map((r) => ({ target: r.target, response: r.response === '?' ? null : r.response, n: Number(r.n) }))} characters={chars} caption={`Aggregate ${phase} confusion matrix`} />
        </div>
      </section>

      <section className="card">
        <h2>Model comparison readiness</h2>
        <p className="small muted">How much complete, comparable data exists for comparing estimators (rules-v1 vs. performance-only, behaviour-augmented, BKT, logistic regression…) on held-out participants. Targets are planning guides for a first comparison, not a power calculation.</p>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Completed Day-1 sessions</th><th className="num">Count</th><th className="num">Planning target</th><th>Status</th></tr></thead>
            <tbody>
              {readinessRows.map((r) => (
                <tr key={r.label}><td>{r.label}</td><td className="num">{r.n}</td><td className="num">{r.target ?? '—'}</td><td>{r.target === undefined ? '' : r.n >= r.target ? 'Reached' : `${r.target - r.n} to go`}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-2">
        <section className="card">
          <h2>Frozen estimates vs. final test</h2>
          <p className="small muted">{day1.length} evaluated Day-1 session(s). Estimator: rules-v1 (provisional thresholds).</p>
          <table className="t">
            <thead><tr><th>Estimate category</th><th className="num">Letters</th><th className="num">Measured final accuracy</th></tr></thead>
            <tbody>
              {EVIDENCE_CATEGORIES.map((k) => {
                const b = catPool[k];
                return <tr key={k}><td>{CATEGORY_LABELS[k]}</td><td className="num">{b?.letters ?? 0}</td><td className="num">{b ? `${pct(b.c, b.n)} (${b.c}/${b.n})` : '—'}</td></tr>;
              })}
            </tbody>
          </table>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>Mean per-session MAE</dt><dd>{mean(mae)?.toFixed(3) ?? '—'}</dd>
            <dt>Mean per-session Brier</dt><dd>{mean(brier)?.toFixed(3) ?? '—'}</dd>
          </dl>
          <p className="small muted">Future estimators (performance-only, +behaviour, BKT, logistic regression, LLM) can be compared here by storing their outputs in analysis_results against the same frozen snapshots.</p>
        </section>
        <section className="card">
          <h2>Predicted vs. measured (per letter)</h2>
          <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Scatter of predicted versus measured final-test accuracy per letter" style={{ maxWidth: 360 }}>
            <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="var(--border)" strokeDasharray="4 4" />
            {[0, 0.5, 1].map((v) => (
              <g key={v}>
                <text x={sx(v)} y={H - 14} fontSize={11} textAnchor="middle" fill="var(--muted)">{v * 100}%</text>
                <text x={pad - 6} y={sy(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">{v * 100}%</text>
              </g>
            ))}
            <text x={W / 2} y={H - 2} fontSize={11} textAnchor="middle" fill="var(--muted)">predicted (frozen)</text>
            {scatter.map((d, i) => (
              <circle key={i} cx={sx(d.p)} cy={sy(d.o)} r={5} fill="var(--accent)" fillOpacity={0.45} stroke="var(--surface)" strokeWidth={2}>
                <title>{`${d.ch}: predicted ${pctv(d.p)}, measured ${pctv(d.o)}`}</title>
              </circle>
            ))}
          </svg>
          <p className="small muted">Measured accuracy per letter is quantised to 0, 25, 50, 75, 100% (four trials).</p>
        </section>
      </div>

      <div className="grid grid-2">
        <section className="card">
          <h2>Prior knowledge</h2>
          <table className="t">
            <thead><tr><th className="num">Self-rating</th><th>Baseline</th><th className="num">Sessions</th><th className="num">Learning acc.</th><th className="num">Final acc.</th></tr></thead>
            <tbody>{a.prior.map((r) => <tr key={`${r.rating}${r.baseline}`}><td className="num">{r.rating}</td><td>{r.baseline === 'tested' ? 'diagnostic' : 'skipped'}</td><td className="num">{r.sessions}</td><td className="num">{pct(Number(r.learn_c), Number(r.learn_n))}</td><td className="num">{pct(Number(r.final_c), Number(r.final_n))}</td></tr>)}</tbody>
          </table>
        </section>
        <section className="card">
          <h2>Device comparison</h2>
          <table className="t">
            <thead><tr><th>Device</th><th>Phase</th><th className="num">Accuracy</th><th className="num">Median RT</th><th className="num">Interrupted</th></tr></thead>
            <tbody>{a.byDevice.map((r) => <tr key={`${r.device}${r.phase}`}><td>{r.device}</td><td>{r.phase}</td><td className="num">{pct(Number(r.c), Number(r.n))}</td><td className="num">{ms(r.median_rt)}</td><td className="num">{r.interrupted}</td></tr>)}</tbody>
          </table>
          <p className="small muted">Latency differs by input method; compare within device type.</p>
        </section>
      </div>

      <section className="card">
        <h2>Learning curve (pooled)</h2>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Trial</th>{a.learningCurve.map((r) => <th key={r.phase_index} className="num">{r.phase_index}</th>)}</tr></thead>
            <tbody><tr><th>Accuracy</th>{a.learningCurve.map((r) => <td key={r.phase_index} className="num">{pct(Number(r.c), Number(r.n))}</td>)}</tr></tbody>
          </table>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary>Behavioural events (all sessions)</summary>
          <table className="t"><thead><tr><th>Type</th><th className="num">Events</th><th className="num">Sessions</th></tr></thead>
            <tbody>{a.behaviour.map((b) => <tr key={b.type}><td>{b.type}</td><td className="num">{b.n}</td><td className="num">{b.sessions}</td></tr>)}</tbody>
          </table>
        </details>
      </section>
    </>
  );
}
