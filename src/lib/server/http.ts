import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { ZodError, type ZodType } from 'zod';
import { AppError, participantFromSessionToken, SESSION_DAYS, type AuthedParticipant } from './participants';
import { env } from './env';
import { log } from './log';
import { rateLimit } from './rate-limit';
import { TransitionError } from '../protocol/state-machine';
import { SnapshotLeakError } from '../estimator/snapshot';

export const PARTICIPANT_COOKIE = 'mr_session';
export const RESEARCHER_COOKIE = 'mr_researcher';

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof AppError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  if (e instanceof ZodError) {
    const msg = e.issues[0]?.message ?? 'Invalid input';
    return NextResponse.json({ error: { code: 'invalid_input', message: msg } }, { status: 400 });
  }
  if (e instanceof TransitionError) return NextResponse.json({ error: { code: 'invalid_transition', message: e.message } }, { status: 409 });
  if (e instanceof SnapshotLeakError) {
    log('error', 'snapshot leak blocked', { error: e.message });
    return NextResponse.json({ error: { code: 'integrity', message: 'Integrity check failed' } }, { status: 500 });
  }
  const pgCode = (e as { code?: string }).code;
  if (pgCode === 'P0001') {
    log('warn', 'database integrity rule rejected a write', { error: (e as Error).message });
    return NextResponse.json({ error: { code: 'integrity', message: 'This change is not allowed.' } }, { status: 409 });
  }
  log('error', 'unhandled error', { error: (e as Error)?.message, stack: (e as Error)?.stack?.split('\n').slice(0, 4).join(' | ') });
  return NextResponse.json({ error: { code: 'server_error', message: 'Something went wrong. Please try again.' } }, { status: 500 });
}

/** CSRF defence for state-changing requests: same-origin Origin header and a JSON body. */
export function checkSameOrigin(req: NextRequest): void {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (origin) {
    let ok = false;
    try {
      const o = new URL(origin);
      ok = o.host === host || origin.replace(/\/$/, '') === env.appUrl;
    } catch {
      ok = false;
    }
    if (!ok) throw new AppError(403, 'bad_origin', 'Cross-site request blocked.');
  } else if (req.headers.get('sec-fetch-site') && req.headers.get('sec-fetch-site') !== 'same-origin') {
    throw new AppError(403, 'bad_origin', 'Cross-site request blocked.');
  }
}

export async function readJson<T>(req: NextRequest, schema: ZodType<T>, maxBytes = 256 * 1024): Promise<T> {
  checkSameOrigin(req);
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) throw new AppError(415, 'unsupported_media_type', 'Expected JSON.');
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new AppError(413, 'too_large', 'Request too large.');
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError(413, 'too_large', 'Request too large.');
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new AppError(400, 'invalid_json', 'Malformed JSON.');
  }
  return schema.parse(raw);
}

export function clientIp(req: NextRequest): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

export async function limitOrThrow(key: string, limit: number, windowSeconds: number): Promise<void> {
  if (!(await rateLimit(key, limit, windowSeconds))) throw new AppError(429, 'rate_limited', 'Too many attempts. Please wait a few minutes and try again.');
}

export async function currentParticipant(): Promise<AuthedParticipant | null> {
  const jar = await cookies();
  return participantFromSessionToken(jar.get(PARTICIPANT_COOKIE)?.value);
}

export async function requireParticipant(): Promise<AuthedParticipant> {
  const p = await currentParticipant();
  if (!p) throw new AppError(401, 'unauthenticated', 'Please sign in to your learner profile.');
  return p;
}

export function setParticipantCookie(res: NextResponse, token: string): void {
  res.cookies.set(PARTICIPANT_COOKIE, token, {
    httpOnly: true,
    secure: env.secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export function clearCookie(res: NextResponse, name: string): void {
  res.cookies.set(name, '', { httpOnly: true, secure: env.secureCookies, sameSite: 'lax', path: '/', maxAge: 0 });
}

/** Wraps an API handler with uniform error handling and no-store caching. */
export function api<A extends unknown[]>(fn: (...args: A) => Promise<NextResponse>) {
  return async (...args: A): Promise<NextResponse> => {
    try {
      const res = await fn(...args);
      res.headers.set('Cache-Control', 'no-store');
      return res;
    } catch (e) {
      const res = errorResponse(e);
      res.headers.set('Cache-Control', 'no-store');
      return res;
    }
  };
}
