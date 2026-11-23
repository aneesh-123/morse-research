import 'server-only';
import { z } from 'zod';
import { q, pool, type Db } from './db';
import type { StudyContact } from '../protocol/consent';
import { PROTOCOLS } from '../protocol/protocols';

export const SettingsSchema = z.object({
  enrollmentOpen: z.boolean(),
  activeDay1Protocol: z.string().refine((v) => PROTOCOLS[v]?.studyType === 'day1_learning', 'Unknown Day-1 protocol'),
  retentionEnabled: z.boolean(),
  activeRetentionProtocol: z.string().refine((v) => PROTOCOLS[v]?.studyType === 'delayed_retention', 'Unknown retention protocol'),
  contact: z.object({
    researcherName: z.string().max(120),
    contactEmail: z.string().max(200),
    institution: z.string().max(200),
    ethicsStatement: z.string().max(1000),
    dataRetention: z.string().min(1).max(1000),
  }),
});

export type StudySettings = z.infer<typeof SettingsSchema>;

export function defaultSettings(): StudySettings {
  const contact: StudyContact = {
    researcherName: process.env.STUDY_CONTACT_NAME ?? '',
    contactEmail: process.env.STUDY_CONTACT_EMAIL ?? '',
    institution: process.env.STUDY_INSTITUTION ?? '',
    ethicsStatement: process.env.STUDY_ETHICS_STATEMENT ?? '',
    dataRetention:
      process.env.STUDY_DATA_RETENTION ??
      'Research data is kept until the end of the research project and is then deleted or fully anonymised.',
  };
  return {
    enrollmentOpen: true,
    activeDay1Protocol: 'day1-v1',
    retentionEnabled: false,
    activeRetentionProtocol: 'retention-v1',
    contact,
  };
}

/** Stored settings override the defaults key by key. */
export async function getSettings(db: Db = pool()): Promise<StudySettings> {
  const rows = await q<{ key: string; value: unknown }>(`SELECT key, value FROM study_settings`, [], db);
  const d = defaultSettings();
  const merged: Record<string, unknown> = { ...d };
  for (const r of rows) {
    if (r.key === 'contact') merged.contact = { ...d.contact, ...(r.value as object) };
    else merged[r.key] = r.value;
  }
  const parsed = SettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : d;
}

export async function saveSettings(s: StudySettings, researcherId: string, db: Db = pool()): Promise<void> {
  const valid = SettingsSchema.parse(s);
  for (const [key, value] of Object.entries(valid)) {
    await db.query(
      `INSERT INTO study_settings (key, value, updated_by) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [key, JSON.stringify(value), researcherId],
    );
  }
}
