import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { api, limitOrThrow, readJson, requireParticipant } from '@/lib/server/http';
import { regenerateRecoveryCode } from '@/lib/server/participants';

export const POST = api(async (req: NextRequest) => {
  await readJson(req, z.object({}).passthrough());
  const p = await requireParticipant();
  await limitOrThrow(`recovery-regen:${p.id}`, 5, 3600);
  return NextResponse.json({ recoveryCode: await regenerateRecoveryCode(p.id) });
});
