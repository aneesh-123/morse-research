'use client';
import { useState } from 'react';

/** Shows a recovery code once, with copy/download, and (optionally) requires confirmation it was saved. */
export function RecoveryCodeCard({ code, required, onDone, doneLabel = 'Continue' }: { code: string; required: boolean; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const blob = new Blob([`Morse Study recovery code\n\n${code}\n\nUse this code on the sign-in page to get back into your learner profile.\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'morse-study-recovery-code.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="card">
      <h2>🔑 Your recovery code</h2>
      <p>This is your key to get back in later, on any device. We show it only once, so copy it or take a screenshot.</p>
      <div className="code-box" data-testid="recovery-code">{code}</div>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-secondary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <button type="button" className="btn btn-secondary" onClick={download}>Download</button>
      </div>
      {required && (
        <div className="notice">
          If you lose this code we can’t get your profile back, and you won’t be able to join follow-up sessions.
        </div>
      )}
      <label className="check" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I saved my recovery code{required ? '' : ' (optional, since you added an email)'}</span>
      </label>
      <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 12 }} disabled={required && !saved} onClick={onDone}>
        {doneLabel}
      </button>
    </section>
  );
}
