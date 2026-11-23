import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { api, limitOrThrow, readJson, requireParticipant } from '@/lib/server/http';
import { startSession } from '@/lib/server/experiment';

export const POST = api(async (req: NextRequest) => {
  const { studyType } = await readJson(req, z.object({ studyType: z.enum(['day1_learning', 'delayed_retention']) }), 1024);
  const p = await requireParticipant();
  await limitOrThrow(`start-session:${p.id}`, 30, 3600);
  const r = await startSession(p.id, studyType);
  return NextResponse.json(r, { status: r.created ? 201 : 200 });
});
