import { expect, test } from '@playwright/test';
import { db } from './helpers';
import { unzipSync, strFromU8 } from 'fflate';

test.describe('researcher dashboard', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop-chrome', 'desktop only'));

  test('is not publicly accessible', async ({ page, request }) => {
    await page.goto('/research');
    await expect(page).toHaveURL(/\/research\/login/);
    for (const url of ['/research/participants', '/research/analysis', '/research/export', '/research/settings']) {
      await page.goto(url);
      await expect(page).toHaveURL(/\/research\/login/);
    }
    const r = await request.get('/api/research/export?dataset=trial_responses');
    expect(r.status()).toBe(401);
    const r2 = await request.post('/api/research/settings', { data: {}, headers: { 'content-type': 'application/json' } });
    expect([400, 401]).toContain(r2.status());
    // Participant APIs require a participant session.
    expect((await request.get('/api/me')).status()).toBe(401);
    const s = await db<{ id: string }>(`SELECT id FROM experiment_sessions LIMIT 1`);
    if (s[0]) expect((await request.get(`/api/sessions/${s[0].id}`)).status()).toBe(401);
    // Cross-site POSTs are refused.
    const x = await request.post('/api/participants', { data: { displayName: 'x', adultConfirmed: true }, headers: { origin: 'https://evil.example', 'content-type': 'application/json' } });
    expect(x.status()).toBe(403);
  });

  test('wrong password is refused; researcher can inspect sessions and export', async ({ page }) => {
    await page.goto('/research/login');
    await page.getByLabel('Email').fill('e2e-researcher@example.org');
    await page.getByLabel('Password').fill('wrong-password-xx');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.error[role="alert"]')).toContainText('incorrect');
    await page.getByLabel('Password').fill('e2e-password-123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(page.getByText('Final test accuracy')).toBeVisible();

    await page.getByRole('link', { name: 'Participants' }).first().click();
    await expect(page.getByRole('heading', { name: 'Participants' })).toBeVisible();
    const completed = await db<{ id: string; participant_id: string }>(`SELECT id, participant_id FROM experiment_sessions WHERE status = 'completed' AND study_type = 'day1_learning' LIMIT 1`);
    test.skip(!completed[0], 'needs a completed session from the participant tests');
    await page.goto(`/research/participants/${completed[0]!.participant_id}`);
    await expect(page.getByText('Session history')).toBeVisible();
    await page.goto(`/research/sessions/${completed[0]!.id}`);
    await expect(page.getByRole('heading', { name: 'Learning trajectory' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Knowledge profile vs. independent test' })).toBeVisible();
    await expect(page.getByText('Confusions during learning')).toBeVisible();
    await expect(page.getByText('Estimate (frozen)')).toBeVisible();

    await page.goto('/research/analysis');
    await expect(page.getByRole('heading', { name: 'Per-letter performance and exposure' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Model comparison readiness' })).toBeVisible();
    await page.goto('/research/settings');
    await expect(page.getByText('day1-v1 — Learning six Morse code letters')).toBeVisible();

    await page.goto('/research/export');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-bundle').click()]);
    const path = await dl.path();
    const fs = await import('node:fs');
    const files = unzipSync(new Uint8Array(fs.readFileSync(path!)));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['csv/participants.csv', 'csv/trial_responses.csv', 'csv/behavioral_events.csv', 'csv/knowledge_profiles.csv', 'json/knowledge_profiles.json', 'DATA_DICTIONARY.md']));
    const participantsCsv = strFromU8(files['csv/participants.csv']!);
    expect(participantsCsv.split('\r\n')[0]).not.toContain('display_name');
    expect(participantsCsv).not.toContain('@');
    const responses = strFromU8(files['csv/trial_responses.csv']!);
    expect(responses.split('\r\n')[0]).toContain('rt_ms');
    const n = Number((await db<{ n: string }>(`SELECT count(*)::text AS n FROM trial_responses r JOIN participants p ON p.id = r.participant_id WHERE NOT p.is_test`))[0]!.n);
    expect(responses.trim().split('\r\n')).toHaveLength(n + 1);
  });
});
