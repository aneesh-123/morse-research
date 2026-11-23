import { getSettings } from '@/lib/server/settings';
import { PROTOCOLS } from '@/lib/protocol/protocols';
import { contactConfigured } from '@/lib/protocol/consent';
import { RULES_V1 } from '@/lib/estimator/config';
import { SettingsForm } from './SettingsForm';

export default async function SettingsPage() {
  const s = await getSettings();
  const protocols = Object.values(PROTOCOLS);
  return (
    <>
      <h1>Study configuration</h1>
      {!contactConfigured(s.contact) && (
        <div className="notice">Researcher name and contact email are not set. In production, new participants cannot consent until they are.</div>
      )}
      <SettingsForm initial={s} day1={protocols.filter((p) => p.studyType === 'day1_learning').map((p) => p.version)} retention={protocols.filter((p) => p.studyType === 'delayed_retention').map((p) => p.version)} />
      <section className="card">
        <h2>Protocol definitions</h2>
        <p className="small muted">Protocols are defined in code (<code>src/lib/protocol/protocols.ts</code>) and registered with a content hash; a version can never be edited. To change the study design, add a new version and select it above. Sessions keep the version they started with.</p>
        {protocols.map((p) => (
          <details key={p.version} style={{ marginBottom: 8 }}>
            <summary>{p.version} — {p.title}</summary>
            <p className="small">{p.description}</p>
            <pre className="small" style={{ overflowX: 'auto', background: 'var(--surface-2)', padding: 12, borderRadius: 8 }}>{JSON.stringify(p, null, 2)}</pre>
          </details>
        ))}
        <details>
          <summary>Estimator {RULES_V1.version} thresholds (provisional)</summary>
          <pre className="small" style={{ overflowX: 'auto', background: 'var(--surface-2)', padding: 12, borderRadius: 8 }}>{JSON.stringify(RULES_V1, null, 2)}</pre>
        </details>
      </section>
    </>
  );
}
