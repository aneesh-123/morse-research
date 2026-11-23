import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { api, clientIp, limitOrThrow, readJson, setParticipantCookie } from '@/lib/server/http';
import { createParticipant } from '@/lib/server/participants';

const Body = z.object({
  displayName: z.string(),
  email: z.string().optional().nullable(),
  adultConfirmed: z.boolean(),
});

export const POST = api(async (req: NextRequest) => {
  const body = await readJson(req, Body, 4096);
  await limitOrThrow(`signup:${clientIp(req)}`, 20, 3600);
  const p = await createParticipant({ displayName: body.displayName, email: body.email?.trim() || null, adultConfirmed: body.adultConfirmed });
  const res = NextResponse.json({
    participant: { publicCode: p.publicCode, displayName: p.displayName },
    recoveryCode: p.recoveryCode,
    emailPending: p.emailPending,
  }, { status: 201 });
  setParticipantCookie(res, p.sessionToken);
  return res;
});
