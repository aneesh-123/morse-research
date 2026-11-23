import { NextResponse, type NextRequest } from 'next/server';
import { api, limitOrThrow, readJson, requireParticipant } from '@/lib/server/http';
import { submitRetentionScreening, RetentionScreeningSchema } from '@/lib/server/experiment';

type Ctx = { params: Promise<{ id: string }> };

export const POST = api(async (req: NextRequest, ctx: Ctx) => {
  const body = await readJson(req, RetentionScreeningSchema, 2048);
  const p = await requireParticipant();
  const { id } = await ctx.params;
  await limitOrThrow(`retention-screening:${p.id}`, 60, 600);
  return NextResponse.json(await submitRetentionScreening(p.id, id, body));
});
