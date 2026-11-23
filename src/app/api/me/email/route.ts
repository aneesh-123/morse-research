import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { api, limitOrThrow, readJson, requireParticipant } from '@/lib/server/http';
import { addEmail } from '@/lib/server/participants';

export const POST = api(async (req: NextRequest) => {
  const { email } = await readJson(req, z.object({ email: z.string().max(200) }), 2048);
  const p = await requireParticipant();
  await limitOrThrow(`add-email:${p.id}`, 5, 3600);
  await addEmail(p.id, email);
  return NextResponse.json({ ok: true });
});
