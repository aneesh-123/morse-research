import { describe, expect, it } from 'vitest';
import { csvValue, toCsv } from '@/lib/export/csv';
import { dictionaryMarkdown, EVENT_DEFINITIONS } from '@/lib/export/dictionary';
import { EVENT_TYPES } from '@/lib/protocol/events';

describe('CSV export formatting', () => {
  it('quotes, escapes and encodes nulls/objects consistently', () => {
    expect(csvValue(null)).toBe('');
    expect(csvValue(undefined)).toBe('');
    expect(csvValue(false)).toBe('false');
    expect(csvValue(0)).toBe('0');
    expect(csvValue('a,b')).toBe('"a,b"');
    expect(csvValue('say "hi"')).toBe('"say ""hi"""');
    expect(csvValue('line\nbreak')).toBe('"line\nbreak"');
    expect(csvValue(['A', 'N'])).toBe('"[""A"",""N""]"');
    expect(csvValue(new Date('2026-01-02T03:04:05.006Z'))).toBe('2026-01-02T03:04:05.006Z');
  });
  it('writes a header and CRLF rows', () => {
    expect(toCsv([{ a: 1, b: null }, { a: 2, b: 'x' }])).toBe('a,b\r\n1,\r\n2,x\r\n');
    expect(toCsv([], ['a'])).toBe('a\r\n');
  });
});

describe('Data dictionary', () => {
  it('documents every event type', () => {
    expect(Object.keys(EVENT_DEFINITIONS).sort()).toEqual([...EVENT_TYPES].sort());
    const md = dictionaryMarkdown();
    for (const t of EVENT_TYPES) expect(md).toContain(`\`${t}\``);
    expect(md).toContain('## trial_responses');
  });
});
