import { displayPattern } from '@/lib/protocol/morse';

/** Visual dot/dash pattern with an accessible text equivalent. */
export function Pattern({ pattern, small = false }: { pattern: string; small?: boolean }) {
  const spoken = [...pattern].map((c) => (c === '.' ? 'dot' : 'dash')).join(' ');
  return (
    <span className={`pattern${small ? ' small' : ''}`} role="img" aria-label={spoken} title={displayPattern(pattern)}>
      {[...pattern].map((c, i) => (
        <span key={i} className={c === '.' ? 'dot' : 'dash'} />
      ))}
    </span>
  );
}
