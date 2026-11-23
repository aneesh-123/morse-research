import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { api, clientIp, limitOrThrow, readJson } from '@/lib/server/http';
import { requestEmailSignIn } from '@/lib/server/participants';
import { sha256 } from '@/lib/server/crypto';

const Body = z.object({ email: z.string().max(200) });

export const POST = api(async (req: NextRequest) => {
  const { email } = await readJson(req, Body, 2048);
  await limitOrThrow(`email-start:${clientIp(req)}`, 10, 900);
  await limitOrThrow(`email-start-addr:${sha256(email.trim().toLowerCase())}`, 5, 900);
  await requestEmailSignIn(email);
  // Same answer whether or not the address has a profile.
  return NextResponse.json({ ok: true, message: 'If a profile uses that email, we sent a sign-in link and code to it.' });
});
