import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { api, limitOrThrow, readJson, requireParticipant } from '@/lib/server/http';
import { freezeProfile } from '@/lib/server/experiment';

type Ctx = { params: Promise<{ id: string }> };

export const POST = api(async (req: NextRequest, ctx: Ctx) => {
  const body = await readJson(req, z.object({}).passthrough(), 1024);
  const p = await requireParticipant();
  const { id } = await ctx.params;
  await limitOrThrow(`profile:${p.id}`, 60, 600);
  return NextResponse.json(await freezeProfile(p.id, id));
});
