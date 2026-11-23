import { NextResponse, type NextRequest } from 'next/server';
import { api, requireParticipant } from '@/lib/server/http';
import { sessionState } from '@/lib/server/experiment';

type Ctx = { params: Promise<{ id: string }> };

export const GET = api(async (_req: NextRequest, ctx: Ctx) => {
  const p = await requireParticipant();
  const { id } = await ctx.params;
  return NextResponse.json(await sessionState(p.id, id));
});
