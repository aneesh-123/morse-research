import { NextResponse, type NextRequest } from 'next/server';
import { clientIp, limitOrThrow, setParticipantCookie, errorResponse } from '@/lib/server/http';
import { signInWithEmailLink } from '@/lib/server/participants';
import { env } from '@/lib/server/env';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await limitOrThrow(`email-link:${clientIp(req)}`, 20, 900);
    const token = req.nextUrl.searchParams.get('token') ?? '';
    const r = token ? await signInWithEmailLink(token) : null;
    const res = NextResponse.redirect(new URL(r ? '/home?signedin=1' : '/signin?link=expired', env.appUrl));
    if (r) setParticipantCookie(res, r.sessionToken);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
