import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { api, limitOrThrow, readJson, requireParticipant } from '@/lib/server/http';
import { submitScreening, ScreeningSchema } from '@/lib/server/experiment';

type Ctx = { params: Promise<{ id: string }> };

export const POST = api(async (req: NextRequest, ctx: Ctx) => {
  const body = await readJson(req, ScreeningSchema, 2048);
  const p = await requireParticipant();
  const { id } = await ctx.params;
  await limitOrThrow(`screening:${p.id}`, 60, 600);
  return NextResponse.json(await submitScreening(p.id, id, body));
});
