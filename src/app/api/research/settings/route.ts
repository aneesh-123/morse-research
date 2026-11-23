import { NextResponse, type NextRequest } from 'next/server';
import { api, readJson } from '@/lib/server/http';
import { requireResearcher, audit } from '@/lib/server/researchers';
import { saveSettings, SettingsSchema } from '@/lib/server/settings';

export const POST = api(async (req: NextRequest) => {
  const body = await readJson(req, SettingsSchema, 16384);
  const r = await requireResearcher();
  await saveSettings(body, r.id);
  await audit(r.id, 'settings_updated', null, body);
  return NextResponse.json({ ok: true });
});
