import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { api, clientIp, limitOrThrow, readJson, setParticipantCookie } from '@/lib/server/http';
import { AppError, signInWithRecoveryCode } from '@/lib/server/participants';

const Body = z.object({ code: z.string().min(10).max(80) });

export const POST = api(async (req: NextRequest) => {
  const { code } = await readJson(req, Body, 2048);
  await limitOrThrow(`recovery:${clientIp(req)}`, 10, 900);
  const r = await signInWithRecoveryCode(code);
  if (!r) throw new AppError(401, 'invalid_code', 'That recovery code was not recognised. Check it and try again.');
  const res = NextResponse.json({ ok: true });
  setParticipantCookie(res, r.sessionToken);
  return res;
});
