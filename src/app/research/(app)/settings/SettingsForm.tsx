'use client';
import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/client/api';
import type { StudySettings } from '@/lib/server/settings';

export function SettingsForm({ initial, day1, retention }: { initial: StudySettings; day1: string[]; retention: string[] }) {
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof StudySettings>(k: K, v: StudySettings[K]) => setS({ ...s, [k]: v });
  const setC = (k: keyof StudySettings['contact'], v: string) => setS({ ...s, contact: { ...s.contact, [k]: v } });
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg(null);
        setErr(null);
        try {
          await apiFetch('/api/research/settings', s);
          setMsg('Saved.');
        } catch (x) {
          setErr(x instanceof ApiError ? x.message : 'Save failed');
        }
      }}
    >
      <h2>Enrollment</h2>
      <label className="check field"><input type="checkbox" checked={s.enrollmentOpen} onChange={(e) => set('enrollmentOpen', e.target.checked)} /><span>Open for new sessions</span></label>
      <div className="field">
        <label htmlFor="d1">Active Day-1 protocol</label>
        <select id="d1" className="input" value={s.activeDay1Protocol} onChange={(e) => set('activeDay1Protocol', e.target.value)}>{day1.map((v) => <option key={v}>{v}</option>)}</select>
      </div>
      <label className="check field"><input type="checkbox" checked={s.retentionEnabled} onChange={(e) => set('retentionEnabled', e.target.checked)} /><span>Offer the delayed follow-up check to eligible participants</span></label>
      <div className="field">
        <label htmlFor="rp">Follow-up protocol</label>
        <select id="rp" className="input" value={s.activeRetentionProtocol} onChange={(e) => set('activeRetentionProtocol', e.target.value)}>{retention.map((v) => <option key={v}>{v}</option>)}</select>
      </div>
      <h2>Consent contact details</h2>
      <p className="small muted">Shown on the consent screen and stored with every consent record. Use real details only; leave the ethics statement empty unless an approval actually exists.</p>
      <div className="field"><label htmlFor="rn">Researcher name</label><input id="rn" className="input" value={s.contact.researcherName} onChange={(e) => setC('researcherName', e.target.value)} /></div>
      <div className="field"><label htmlFor="ce">Contact email</label><input id="ce" className="input" type="email" value={s.contact.contactEmail} onChange={(e) => setC('contactEmail', e.target.value)} /></div>
      <div className="field"><label htmlFor="in">Institution (optional)</label><input id="in" className="input" value={s.contact.institution} onChange={(e) => setC('institution', e.target.value)} /></div>
      <div className="field"><label htmlFor="es">Ethics statement (optional)</label><textarea id="es" className="input" rows={2} value={s.contact.ethicsStatement} onChange={(e) => setC('ethicsStatement', e.target.value)} /><div className="hint">If empty, participants see: “This is an independent research pilot. It has not been reviewed by an institutional ethics board.”</div></div>
      <div className="field"><label htmlFor="dr">Data retention statement</label><textarea id="dr" className="input" rows={2} value={s.contact.dataRetention} onChange={(e) => setC('dataRetention', e.target.value)} /></div>
      {msg && <div className="info">{msg}</div>}
      {err && <div className="error">{err}</div>}
      <button className="btn btn-primary">Save configuration</button>
      <p className="hint">Changing the consent text changes its hash; participants on the consent screen are asked to re-read it.</p>
    </form>
  );
}
