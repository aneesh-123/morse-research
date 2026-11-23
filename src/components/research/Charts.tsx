/**
 * Small server-rendered SVG charts for the researcher dashboard. Each mark carries a <title>
 * so hovering shows exact values, and every chart has a table elsewhere on the page.
 * Colours use the page tokens so light/dark modes both work; correctness is double-encoded
 * (filled vs hollow), never colour alone.
 */

export interface TrialPoint {
  index: number; // 1-based within phase
  correct: boolean;
  idk: boolean;
  target: string;
  response: string | null;
  rtMs: number | null;
  interrupted: boolean;
  replays: number;
  block: number | null;
}

const W = 760;

function rolling(points: TrialPoint[], window: number): (number | null)[] {
  return points.map((_, i) => {
    if (i + 1 < window) return null;
    const slice = points.slice(i + 1 - window, i + 1);
    return slice.filter((p) => p.correct).length / window;
  });
}

export function TrajectoryChart({ points, introductions, title }: { points: TrialPoint[]; introductions: { index: number; label: string }[]; title: string }) {
  if (!points.length) return <p className="muted">No trials yet.</p>;
  const H = 230, padL = 40, padR = 12, padT = 24, padB = 28;
  const n = points.length;
  const x = (i: number) => padL + ((i - 0.5) / n) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v) * (H - padT - padB);
  const roll = rolling(points, 5);
  const path = roll.map((v, i) => (v === null ? null : `${x(i + 1)},${y(v)}`)).filter(Boolean);
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 6} y={y(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">{Math.round(v * 100)}%</text>
          </g>
        ))}
        {introductions.map((b) => (
          <g key={b.index}>
            <line x1={x(b.index) - (W - padL - padR) / n / 2} x2={x(b.index) - (W - padL - padR) / n / 2} y1={padT - 8} y2={H - padB} stroke="var(--muted)" strokeDasharray="3 3" strokeWidth={1} />
            <text x={x(b.index) - (W - padL - padR) / n / 2 + 3} y={padT - 10} fontSize={11} fill="var(--muted)">{b.label}</text>
          </g>
        ))}
        {path.length > 1 && <polyline points={path.join(' ')} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i + 1)}
            cy={p.correct ? y(1) + 0 : y(0)}
            r={4.5}
            fill={p.correct ? 'var(--accent)' : 'var(--surface)'}
            stroke={p.interrupted ? 'var(--warn)' : 'var(--accent)'}
            strokeWidth={p.interrupted ? 2.5 : 1.5}
          >
            <title>{`Trial ${p.index}${p.block ? ` (block ${p.block})` : ''}: target ${p.target}, answered ${p.idk ? "I don't know" : p.response} — ${p.correct ? 'correct' : 'wrong'}${p.rtMs !== null ? `, ${Math.round(p.rtMs)} ms` : ''}${p.replays ? `, ${p.replays} replay(s)` : ''}${p.interrupted ? ', interrupted' : ''}`}</title>
          </circle>
        ))}
        {points.map((p, i) => (i + 1) % 8 === 0 || i === 0 ? <text key={`t${i}`} x={x(i + 1)} y={H - 8} fontSize={11} textAnchor="middle" fill="var(--muted)">{p.index}</text> : null)}
      </svg>
      <figcaption className="legend">
        <span style={{ ['--c' as string]: 'var(--accent)' }}>Rolling accuracy (last 5 trials)</span>
        <span>● correct (top row) · ○ wrong (bottom row) · orange ring = interrupted · dashed line = letter introduced</span>
      </figcaption>
    </figure>
  );
}

export function LatencyChart({ points, title }: { points: TrialPoint[]; title: string }) {
  const valid = points.filter((p) => p.rtMs !== null);
  if (!valid.length) return <p className="muted">No latency data.</p>;
  const H = 200, padL = 52, padR = 12, padT = 12, padB = 28;
  const n = points.length;
  const sorted = valid.map((p) => p.rtMs as number).sort((a, b) => a - b);
  const cap = Math.max(1000, sorted[Math.floor(sorted.length * 0.95)] ?? 1000);
  const x = (i: number) => padL + ((i - 0.5) / n) * (W - padL - padR);
  const y = (v: number) => padT + (1 - Math.min(v, cap) / cap) * (H - padT - padB);
  const ticks = [0, cap / 2, cap];
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--border)" />
            <text x={padL - 6} y={y(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">{(v / 1000).toFixed(1)}s</text>
          </g>
        ))}
        {points.map((p, i) =>
          p.rtMs === null ? null : (
            <g key={i}>
              {p.replays > 0 && <rect x={x(i + 1) - 3} y={H - padB - Math.min(p.replays, 5) * 6} width={6} height={Math.min(p.replays, 5) * 6} rx={2} fill="var(--muted)" opacity={0.5} />}
              <circle cx={x(i + 1)} cy={y(p.rtMs)} r={4} fill={p.correct ? 'var(--accent)' : 'var(--surface)'} stroke={p.interrupted ? 'var(--warn)' : 'var(--accent)'} strokeWidth={p.interrupted ? 2.5 : 1.5}>
                <title>{`Trial ${p.index}: ${Math.round(p.rtMs)} ms after the signal ended${(p.rtMs as number) > cap ? ' (clipped)' : ''}; ${p.correct ? 'correct' : 'wrong'}${p.replays ? `; ${p.replays} replay(s)` : ''}${p.interrupted ? '; interrupted' : ''}`}</title>
              </circle>
            </g>
          ),
        )}
      </svg>
      <figcaption className="legend">
        <span>Response latency from the end of the first playback (clipped at {(cap / 1000).toFixed(1)} s) · grey bars = replays</span>
      </figcaption>
    </figure>
  );
}

/** One strip per character: its learning trials in order (filled = correct). */
export function CharacterStrips({ points, characters }: { points: TrialPoint[]; characters: string[] }) {
  return (
    <div className="stack">
      {characters.map((c) => {
        const ps = points.filter((p) => p.target === c);
        return (
          <div key={c} className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <strong style={{ width: 18 }}>{c}</strong>
            <svg viewBox={`0 0 ${Math.max(1, ps.length) * 18} 16`} width={Math.max(1, ps.length) * 18} height={16} role="img" aria-label={`${c}: ${ps.filter((p) => p.correct).length} of ${ps.length} correct`}>
              {ps.map((p, i) => (
                <rect key={i} x={i * 18 + 2} y={2} width={12} height={12} rx={3} fill={p.correct ? 'var(--accent)' : 'var(--surface)'} stroke={p.interrupted ? 'var(--warn)' : 'var(--accent)'} strokeWidth={1.5}>
                  <title>{`Trial ${p.index}: answered ${p.idk ? "I don't know" : p.response} (${p.correct ? 'correct' : 'wrong'})`}</title>
                </rect>
              ))}
            </svg>
            <span className="small muted">{ps.filter((p) => p.correct).length}/{ps.length}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Confusion matrix as an accessible table; cell shading is proportional to the row share. */
export function ConfusionMatrix({ rows, characters, caption }: { rows: { target: string; response: string | null; n: number }[]; characters: string[]; caption: string }) {
  const cols = [...characters, '?'];
  const get = (t: string, r: string) => rows.filter((x) => x.target === t && (x.response ?? '?') === r).reduce((s, x) => s + x.n, 0);
  return (
    <div className="table-wrap">
      <table className="t">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th>Target ↓ / answer →</th>
            {cols.map((c) => <th key={c} className="num">{c === '?' ? "Don't know" : c}</th>)}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {characters.map((t) => {
            const total = cols.reduce((s, c) => s + get(t, c), 0);
            return (
              <tr key={t}>
                <th>{t}</th>
                {cols.map((c) => {
                  const v = get(t, c);
                  const share = total ? v / total : 0;
                  const diag = c === t;
                  return (
                    <td key={c} className="num" style={{ background: v ? `color-mix(in srgb, ${diag ? 'var(--accent)' : 'var(--bad)'} ${Math.round(12 + share * 60)}%, var(--surface))` : undefined, fontWeight: diag ? 700 : 400 }} title={`${t} answered as ${c === '?' ? "I don't know" : c}: ${v} of ${total}`}>
                      {v || ''}
                    </td>
                  );
                })}
                <td className="num muted">{total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Bar({ value, max = 1, label }: { value: number | null; max?: number; label?: string }) {
  if (value === null) return <span className="muted">—</span>;
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ display: 'inline-block', width: 60, height: 8, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 4 }} />
      </span>
      <span>{label ?? `${Math.round(pct)}%`}</span>
    </span>
  );
}
