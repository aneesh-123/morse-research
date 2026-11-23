import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { api, clearCookie, PARTICIPANT_COOKIE, readJson } from '@/lib/server/http';
import { revokeSessionToken } from '@/lib/server/participants';

export const POST = api(async (req: NextRequest) => {
  await readJson(req, z.object({}).passthrough());
  const token = (await cookies()).get(PARTICIPANT_COOKIE)?.value;
  if (token) await revokeSessionToken(token);
  const res = NextResponse.json({ ok: true });
  clearCookie(res, PARTICIPANT_COOKIE);
  return res;
});
