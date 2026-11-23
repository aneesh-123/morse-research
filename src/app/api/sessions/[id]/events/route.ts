import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { api, limitOrThrow, readJson, requireParticipant } from '@/lib/server/http';
import { recordEvents, EventBatchSchema } from '@/lib/server/experiment';

type Ctx = { params: Promise<{ id: string }> };

export const POST = api(async (req: NextRequest, ctx: Ctx) => {
  const body = await readJson(req, EventBatchSchema, 262144);
  const p = await requireParticipant();
  const { id } = await ctx.params;
  await limitOrThrow(`events:${p.id}`, 600, 600);
  return NextResponse.json(await recordEvents(p.id, id, body.events));
});
