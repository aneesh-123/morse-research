import { NextResponse, type NextRequest } from 'next/server';
import { strToU8, zipSync } from 'fflate';
import { z } from 'zod';
import { api } from '@/lib/server/http';
import { audit, requireResearcher } from '@/lib/server/researchers';
import { AppError } from '@/lib/server/participants';
import { dataset, DATASETS, type Dataset, type ExportOptions } from '@/lib/export/datasets';
import { toCsv } from '@/lib/export/csv';
import { dictionaryMarkdown } from '@/lib/export/dictionary';

export const dynamic = 'force-dynamic';

const Query = z.object({
  dataset: z.enum([...DATASETS, 'bundle', 'participant_history']),
  format: z.enum(['csv', 'json']).default('csv'),
  identifiers: z.enum(['0', '1']).default('0'),
  test: z.enum(['0', '1']).default('0'),
  participant: z.string().uuid().optional(),
});

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function file(body: string | Uint8Array, name: string, type: string) {
  return new NextResponse(body as BodyInit, {
    headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"` },
  });
}

export const GET = api(async (req: NextRequest) => {
  const r = await requireResearcher();
  const qp = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const opts: ExportOptions = { includeIdentifiers: qp.identifiers === '1', includeTest: qp.test === '1', participantId: qp.participant };
  await audit(r.id, 'export', qp.dataset, { format: qp.format, ...opts });

  if (qp.dataset === 'participant_history') {
    if (!qp.participant) throw new AppError(400, 'participant_required', 'participant is required');
    const o = { ...opts, includeTest: true };
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), participant_id: qp.participant };
    for (const d of ['participants', 'sessions', 'consent_records', 'trial_schedule', 'trial_responses', 'behavioral_events', 'knowledge_profiles', 'evaluations'] as Dataset[]) {
      out[d] = await dataset(d, o);
    }
    out.protocols = await dataset('protocols');
    return file(JSON.stringify(out, null, 2), `participant-${qp.participant.slice(0, 8)}-${stamp()}.json`, 'application/json');
  }

  if (qp.dataset === 'bundle') {
    const files: Record<string, Uint8Array> = {};
    for (const d of DATASETS) {
      const rows = await dataset(d, opts);
      files[`csv/${d}.csv`] = strToU8(toCsv(rows));
      if (['knowledge_profiles', 'evaluations', 'protocols', 'sessions', 'behavioral_events'].includes(d)) files[`json/${d}.json`] = strToU8(JSON.stringify(rows, null, 2));
    }
    files['DATA_DICTIONARY.md'] = strToU8(dictionaryMarkdown());
    files['README.txt'] = strToU8(
      `Morse learning study export\nCreated ${new Date().toISOString()}\nIdentifiers included: ${opts.includeIdentifiers ? 'yes' : 'no'}; test participants included: ${opts.includeTest ? 'yes' : 'no'}\n` +
      `CSV: empty field = NULL (not applicable / not measured). Join on participant_id, session_id, profile_id, (session_id, position).\nSee DATA_DICTIONARY.md.\n`,
    );
    return file(zipSync(files, { level: 6 }), `morse-study-export-${stamp()}.zip`, 'application/zip');
  }

  const rows = await dataset(qp.dataset, opts);
  if (qp.format === 'json') return file(JSON.stringify(rows, null, 2), `${qp.dataset}-${stamp()}.json`, 'application/json');
  return file(toCsv(rows), `${qp.dataset}-${stamp()}.csv`, 'text/csv; charset=utf-8');
});
