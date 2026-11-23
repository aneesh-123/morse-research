import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { api, readJson } from '@/lib/server/http';
import { requireResearcher, audit } from '@/lib/server/researchers';
import { AppError, deleteParticipantCompletely } from '@/lib/server/participants';
import { q } from '@/lib/server/db';

type Ctx = { params: Promise<{ id: string }> };
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set_test'), value: z.boolean() }),
  z.object({ action: z.literal('delete'), confirm: z.literal('DELETE') }),
]);

export const POST = api(async (req: NextRequest, ctx: Ctx) => {
  const body = await readJson(req, Body, 1024);
  const r = await requireResearcher();
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw new AppError(404, 'not_found', 'Not found');
  if (body.action === 'set_test') {
    await q(`UPDATE participants SET is_test = $2 WHERE id = $1`, [id, body.value]);
    await audit(r.id, 'participant_set_test', id, { value: body.value });
  } else {
    const out = await deleteParticipantCompletely(id);
    await audit(r.id, 'participant_deleted', id, out);
  }
  return NextResponse.json({ ok: true });
});
