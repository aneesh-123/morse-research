import { NextResponse } from 'next/server';
import { api, requireParticipant } from '@/lib/server/http';
import { participantOverview } from '@/lib/server/experiment';

export const GET = api(async () => {
  const p = await requireParticipant();
  return NextResponse.json(await participantOverview(p.id));
});
