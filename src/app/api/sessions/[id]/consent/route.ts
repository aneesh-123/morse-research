import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { api, limitOrThrow, readJson, requireParticipant } from '@/lib/server/http';
import { recordConsent } from '@/lib/server/experiment';

type Ctx = { params: Promise<{ id: string }> };

export const POST = api(async (req: NextRequest, ctx: Ctx) => {
  const body = await readJson(req, z.object({ decision: z.enum(['agreed', 'declined']), consentSha256: z.string().length(64) }), 2048);
  const p = await requireParticipant();
  const { id } = await ctx.params;
  await limitOrThrow(`consent:${p.id}`, 60, 600);
  return NextResponse.json(await recordConsent(p.id, id, body));
});
