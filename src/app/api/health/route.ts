import { NextResponse } from 'next/server';
import { q1 } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

/** Liveness + database check for uptime monitors. Reveals no data. */
export async function GET() {
  try {
    const r = await q1<{ n: string }>(`SELECT count(*)::text AS n FROM schema_migrations`);
    return NextResponse.json({ ok: true, migrations: Number(r?.n ?? 0) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
