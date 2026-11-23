import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { api, clearCookie, PARTICIPANT_COOKIE, readJson, requireParticipant } from '@/lib/server/http';
import { deleteParticipantCompletely } from '@/lib/server/participants';
import { log } from '@/lib/server/log';

export const POST = api(async (req: NextRequest) => {
  await readJson(req, z.object({ confirm: z.literal('DELETE') }));
  const p = await requireParticipant();
  const r = await deleteParticipantCompletely(p.id);
  log('info', 'participant deleted own data', { sessions: r.sessionsDeleted });
  const res = NextResponse.json({ ok: true });
  clearCookie(res, PARTICIPANT_COOKIE);
  return res;
});
