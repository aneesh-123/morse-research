import { DATASETS } from '@/lib/export/datasets';
import { TABLES } from '@/lib/export/dictionary';

const DESCR: Record<string, string> = Object.fromEntries(TABLES.flatMap((t) => t.name.split(' / ').map((n) => [n, t.description])));

export default async function ExportPage({ searchParams }: { searchParams: Promise<{ identifiers?: string; test?: string }> }) {
  const sp = await searchParams;
  const qs = `identifiers=${sp.identifiers === '1' ? 1 : 0}&test=${sp.test === '1' ? 1 : 0}`;
  return (
    <>
      <h1>Data exports</h1>
      <form className="filters" method="get">
        <label className="row small" style={{ fontWeight: 500, margin: 0 }}><input type="checkbox" name="identifiers" value="1" defaultChecked={sp.identifiers === '1'} /> include nicknames (identifiable)</label>
        <label className="row small" style={{ fontWeight: 500, margin: 0 }}><input type="checkbox" name="test" value="1" defaultChecked={sp.test === '1'} /> include test participants</label>
        <button className="btn btn-secondary" style={{ minHeight: 40 }}>Apply</button>
      </form>
      <section className="card">
        <h2>Everything in one file</h2>
        <p>ZIP with every dataset as CSV, nested JSON for profiles, evaluations, sessions, events and protocols, and the data dictionary.</p>
        <a className="btn btn-primary" href={`/api/research/export?dataset=bundle&${qs}`} data-testid="export-bundle">Download full export (.zip)</a>
        <p className="hint">Emails, recovery codes and sign-in tokens are never exported. Every download is recorded in the audit log.</p>
      </section>
      <section className="card">
        <h2>Individual datasets</h2>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Dataset</th><th>Contents</th><th>Download</th></tr></thead>
            <tbody>
              {DATASETS.map((d) => (
                <tr key={d}>
                  <td><code>{d}</code></td>
                  <td className="wrap small">{DESCR[d] ?? ''}</td>
                  <td><a href={`/api/research/export?dataset=${d}&format=csv&${qs}`}>CSV</a> · <a href={`/api/research/export?dataset=${d}&format=json&${qs}`}>JSON</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">One participant&apos;s full history (all sessions, schedules, responses, events, profiles, evaluations) is available as JSON from the participant page or via <code>/api/research/export?dataset=participant_history&amp;participant=&lt;id&gt;</code>.</p>
      </section>
    </>
  );
}
