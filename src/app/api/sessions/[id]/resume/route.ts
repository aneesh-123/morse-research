import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { api, limitOrThrow, readJson, requireParticipant } from '@/lib/server/http';
import { markResumed } from '@/lib/server/experiment';

type Ctx = { params: Promise<{ id: string }> };

export const POST = api(async (req: NextRequest, ctx: Ctx) => {
  await readJson(req, z.object({}).passthrough(), 1024);
  const p = await requireParticipant();
  const { id } = await ctx.params;
  await limitOrThrow(`resume:${p.id}`, 120, 600);
  return NextResponse.json(await markResumed(p.id, id));
});
