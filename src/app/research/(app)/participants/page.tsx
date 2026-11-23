import Link from 'next/link';
import { listParticipants } from '@/lib/server/research';
import { dt, pct } from '@/components/research/format';

export default async function Participants({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; device?: string; test?: string }> }) {
  const sp = await searchParams;
  const rows = await listParticipants({ search: sp.q?.trim(), status: sp.status, device: sp.device, includeTest: sp.test === '1' });
  return (
    <>
      <h1>Participants</h1>
      <form className="filters" method="get">
        <input className="input" name="q" placeholder="Search code, nickname or ID" defaultValue={sp.q ?? ''} aria-label="Search" />
        <select className="input" name="status" defaultValue={sp.status ?? ''} aria-label="Status">
          <option value="">Any status</option>
          <option value="completed">Completed a session</option>
          <option value="in_progress">Has a session in progress</option>
          <option value="no_session">No session yet</option>
        </select>
        <select className="input" name="device" defaultValue={sp.device ?? ''} aria-label="Device">
          <option value="">Any device</option>
          <option value="mobile">Mobile</option>
          <option value="tablet">Tablet</option>
          <option value="desktop">Desktop</option>
        </select>
        <label className="row small" style={{ fontWeight: 500, margin: 0 }}><input type="checkbox" name="test" value="1" defaultChecked={sp.test === '1'} /> include test</label>
        <button className="btn btn-secondary" style={{ minHeight: 40 }}>Filter</button>
      </form>
      <p className="small muted">{rows.length} participant(s){rows.length === 500 ? ' (first 500)' : ''}.</p>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr><th>Code</th><th>Nickname</th><th className="num">Sessions</th><th>Status</th><th>Last participation</th><th className="num">Prior rating</th><th>Baseline</th><th className="num">Final test</th><th>Devices</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/research/participants/${r.id}`}>{r.public_code}</Link>{r.is_test && <span className="badge warn" style={{ marginLeft: 6 }}>test</span>}</td>
                <td>{r.display_name}</td>
                <td className="num">{r.sessions}</td>
                <td>{r.completed ? <span className="badge good">completed {r.completed}</span> : r.in_progress ? <span className="badge accent">in progress</span> : <span className="badge">—</span>}</td>
                <td>{dt(r.last_participation)}</td>
                <td className="num">{r.prior_rating ?? '—'}</td>
                <td>{r.baseline_status === 'tested' ? 'diagnostic' : r.baseline_status ? 'skipped' : '—'}</td>
                <td className="num">{r.final_total ? `${r.final_correct}/${r.final_total} (${pct(r.final_correct ?? 0, r.final_total)})` : '—'}</td>
                <td>{r.devices ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
