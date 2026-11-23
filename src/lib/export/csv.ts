/**
 * CSV formatting (RFC 4180). Conventions, also documented in the data dictionary:
 *  - header row; comma separator; UTF-8; CRLF line endings;
 *  - NULL is an empty field (read as NA by R / NaN by pandas); booleans are true/false;
 *  - timestamps are ISO 8601 UTC; arrays and objects are JSON text in one field.
 */

export function csvValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const lines = [cols.map(csvValue).join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvValue(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}
