/** Minimal structured logger (JSON lines). Never log tokens, codes, emails or passwords. */
type Level = 'info' | 'warn' | 'error';
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
