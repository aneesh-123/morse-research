export const pct = (c: number, n: number) => (n ? `${Math.round((c / n) * 100)}%` : '—');
export const pctv = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
export const ms = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v)} ms`);
export const dt = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) + 'Z' : '—');
export const mins = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1)} min`);
export const CATEGORY_BADGE: Record<string, string> = {
  strong_evidence: 'good',
  some_evidence: 'accent',
  uncertain_inconsistent: 'warn',
  little_evidence: 'bad',
  insufficient_evidence: '',
};
