import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { api, clearCookie, readJson, RESEARCHER_COOKIE } from '@/lib/server/http';
import { researcherLogout } from '@/lib/server/researchers';

export const POST = api(async (req: NextRequest) => {
  await readJson(req, z.object({}).passthrough());
  await researcherLogout((await cookies()).get(RESEARCHER_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  clearCookie(res, RESEARCHER_COOKIE);
  return res;
});
