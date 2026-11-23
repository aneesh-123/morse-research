import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { api, clientIp, limitOrThrow, readJson, setParticipantCookie } from '@/lib/server/http';
import { AppError, signInWithEmailCode } from '@/lib/server/participants';

const Body = z.object({ email: z.string().max(200), code: z.string().max(20) });

export const POST = api(async (req: NextRequest) => {
  const { email, code } = await readJson(req, Body, 2048);
  await limitOrThrow(`email-code:${clientIp(req)}`, 15, 900);
  const r = await signInWithEmailCode(email, code);
  if (!r) throw new AppError(401, 'invalid_code', 'That code is wrong or has expired. Request a new one if needed.');
  const res = NextResponse.json({ ok: true });
  setParticipantCookie(res, r.sessionToken);
  return res;
});
