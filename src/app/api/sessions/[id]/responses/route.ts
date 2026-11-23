import { NextResponse, type NextRequest } from 'next/server';
import { api, limitOrThrow, readJson, requireParticipant } from '@/lib/server/http';
import { submitResponse, ResponseSchema } from '@/lib/server/experiment';

type Ctx = { params: Promise<{ id: string }> };

export const POST = api(async (req: NextRequest, ctx: Ctx) => {
  const body = await readJson(req, ResponseSchema, 8192);
  const p = await requireParticipant();
  const { id } = await ctx.params;
  await limitOrThrow(`responses:${p.id}`, 600, 600);
  return NextResponse.json(await submitResponse(p.id, id, body));
});
