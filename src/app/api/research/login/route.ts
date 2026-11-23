import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { api, clientIp, limitOrThrow, readJson, RESEARCHER_COOKIE } from '@/lib/server/http';
import { researcherLogin, RESEARCHER_SESSION_HOURS } from '@/lib/server/researchers';
import { AppError } from '@/lib/server/participants';
import { env } from '@/lib/server/env';

export const POST = api(async (req: NextRequest) => {
  const { email, password } = await readJson(req, z.object({ email: z.string().max(200), password: z.string().max(200) }), 2048);
  await limitOrThrow(`researcher-login:${clientIp(req)}`, 10, 900);
  const token = await researcherLogin(email, password);
  if (!token) throw new AppError(401, 'invalid_login', 'Email or password is incorrect.');
  const res = NextResponse.json({ ok: true });
  res.cookies.set(RESEARCHER_COOKIE, token, { httpOnly: true, secure: env.secureCookies, sameSite: 'strict', path: '/', maxAge: RESEARCHER_SESSION_HOURS * 3600 });
  return res;
});
