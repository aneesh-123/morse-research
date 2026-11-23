import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { api, readJson } from '@/lib/server/http';
import { requireResearcher, audit } from '@/lib/server/researchers';
import { AppError } from '@/lib/server/participants';
import { q1, q } from '@/lib/server/db';
import { evaluateSession } from '@/lib/server/experiment';
import { isTerminal, assertTransition, type Stage } from '@/lib/protocol/state-machine';

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ action: z.enum(['abandon', 'reevaluate']) });

export const POST = api(async (req: NextRequest, ctx: Ctx) => {
  const { action } = await readJson(req, Body, 512);
  const r = await requireResearcher();
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw new AppError(404, 'not_found', 'Not found');
  const s = await q1<{ stage: Stage }>(`SELECT stage FROM experiment_sessions WHERE id = $1`, [id]);
  if (!s) throw new AppError(404, 'not_found', 'Not found');
  if (action === 'abandon') {
    if (isTerminal(s.stage)) throw new AppError(409, 'wrong_stage', 'Session already ended.');
    assertTransition(s.stage, 'abandoned');
    await q(
      `UPDATE experiment_sessions SET stage = 'abandoned', end_reason = 'marked_abandoned_by_researcher',
         stage_history = stage_history || jsonb_build_array(jsonb_build_object('from', stage, 'to', 'abandoned', 'at', now())) WHERE id = $1`,
      [id],
    );
  } else {
    await evaluateSession(id);
  }
  await audit(r.id, `session_${action}`, id);
  return NextResponse.json({ ok: true });
});
