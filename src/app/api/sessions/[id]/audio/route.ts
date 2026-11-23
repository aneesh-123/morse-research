import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { api, limitOrThrow, readJson, requireParticipant } from '@/lib/server/http';
import { completeAudioSetup, ClientInfoSchema } from '@/lib/server/experiment';

type Ctx = { params: Promise<{ id: string }> };

export const POST = api(async (req: NextRequest, ctx: Ctx) => {
  const body = await readJson(req, ClientInfoSchema, 4096);
  const p = await requireParticipant();
  const { id } = await ctx.params;
  await limitOrThrow(`audio:${p.id}`, 60, 600);
  return NextResponse.json(await completeAudioSetup(p.id, id, body));
});
