import { expect, test, type Page } from '@playwright/test';
import { answerTrials, clickThroughConsentSlides, createProfile, db, screening, sessionIdFromUrl, startAndConsent } from './helpers';

test.beforeEach(({}, info) => test.skip(info.project.name !== 'android-pixel7' && info.project.name !== 'iphone13-emulated', 'phone projects only'));

async function currentPos(sid: string) {
  return (await db<{ current_position: number }>(`SELECT current_position FROM experiment_sessions WHERE id = $1`, [sid]))[0]!.current_position;
}
async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('refresh, tab interruption, offline answer and returning sign-in', async ({ page, browser }, info) => {
  const code = await createProfile(page, `Resilient ${info.project.name}`);
  await startAndConsent(page);
  await screening(page, true);
  const sid = sessionIdFromUrl(page);

  // Answer 5 learning trials.
  await answerTrials(page, sid, ['learning'], (t) => t, { max: 5 });
  const scheduleBefore = await db(`SELECT position, target FROM trial_schedule WHERE session_id = $1 ORDER BY position`, [sid]);
  expect(scheduleBefore).toHaveLength(72);
  await expect(page.locator('button.answer:enabled').first()).toBeVisible({ timeout: 15_000 });
  const pos = await currentPos(sid);
  expect(pos).toBe(6);

  // 1) Reload mid-trial: resume gate, same trial, schedule unchanged, restart recorded.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByTestId('phase-start').click();
  expect(await currentPos(sid)).toBe(6);
  expect(await db(`SELECT position, target FROM trial_schedule WHERE session_id = $1 ORDER BY position`, [sid])).toEqual(scheduleBefore);
  await answerTrials(page, sid, ['learning'], (t) => t, { max: 1 });
  const r6 = (await db<{ presentation_number: number; restarted: boolean; interrupted: boolean }>(`SELECT * FROM trial_responses WHERE session_id = $1 AND position = 6`, [sid]))[0]!;
  expect(r6).toMatchObject({ presentation_number: 2, restarted: true, interrupted: true });

  // 2) Page hidden while the signal is about to play: trial pauses, restarts, and is flagged.
  await expect(page.getByTestId('status')).toBeVisible();
  await setHidden(page, true);
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await setHidden(page, false);
  await page.getByRole('button', { name: 'Continue' }).click();
  await answerTrials(page, sid, ['learning'], (t) => t, { max: 1 });
  const r7 = (await db<{ playback_interrupted: boolean; tab_hidden_during: boolean; presentation_number: number; timing_flags: string[] }>(`SELECT * FROM trial_responses WHERE session_id = $1 AND position = 7`, [sid]))[0]!;
  expect(r7.playback_interrupted).toBe(true);
  expect(r7.tab_hidden_during).toBe(true);
  expect(r7.presentation_number).toBe(2);
  // Telemetry is batched (every few seconds), so wait for the batch to arrive.
  await expect
    .poll(async () => (await db<{ type: string }>(`SELECT type FROM behavioral_events WHERE session_id = $1 AND trial_position = 7`, [sid])).map((e) => e.type), { timeout: 20_000 })
    .toEqual(expect.arrayContaining(['playback_interrupted', 'trial_restarted']));

  // 3) Offline while answering: the answer is held and sent once back online, exactly once.
  await expect(page.locator('button.answer:enabled').first()).toBeVisible({ timeout: 15_000 });
  const target = (await db<{ target: string }>(`SELECT target FROM trial_schedule WHERE session_id = $1 AND position = 8`, [sid]))[0]!.target;
  await page.context().setOffline(true);
  await page.getByTestId(`answer-${target}`).click();
  await expect(page.getByTestId('status')).toContainText('Saving your answer', { timeout: 20_000 });
  expect(await db(`SELECT 1 FROM trial_responses WHERE session_id = $1 AND position = 8`, [sid])).toHaveLength(0);
  await page.context().setOffline(false);
  await expect(page.getByTestId('feedback')).toBeVisible({ timeout: 30_000 });
  expect(await db(`SELECT 1 FROM trial_responses WHERE session_id = $1 AND position = 8`, [sid])).toHaveLength(1);
  await page.getByTestId('next').click();

  // 4) Returning participant on a new device: recovery-code sign-in and resume.
  const ctx2 = await browser.newContext({ ...info.project.use });
  const p2 = await ctx2.newPage();
  await p2.goto('/signin');
  await p2.getByRole('tab', { name: 'With recovery code' }).click();
  await p2.getByLabel('Recovery code').fill(code.toLowerCase());
  await p2.getByRole('button', { name: 'Sign in' }).click();
  await expect(p2).toHaveURL(/\/home/);
  await expect(p2.getByText('You have a session in progress')).toBeVisible();
  await p2.getByRole('link', { name: 'Resume session' }).click();
  await expect(p2.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await p2.getByTestId('phase-start').click();
  // Position 9 opens block 2, so the new letter (A) is introduced first.
  await expect(p2.getByTestId('intro-A')).toBeVisible();
  await expect(p2.getByTestId('start-practice')).toBeEnabled({ timeout: 15_000 });
  await p2.getByTestId('start-practice').click();
  await expect(p2.locator('button.answer:enabled').first()).toBeVisible({ timeout: 15_000 });
  expect(await currentPos(sid)).toBe(9);
  await ctx2.close();
});

test('declining consent records nothing else; deleting the account removes all data', async ({ page }) => {
  await createProfile(page, 'Decliner');
  await page.getByRole('button', { name: 'Start' }).click();
  await clickThroughConsentSlides(page);
  await page.getByTestId('consent-decline').click();
  await expect(page.getByRole('heading', { name: 'Session ended' })).toBeVisible();
  const sid = sessionIdFromUrl(page);
  expect(await db(`SELECT 1 FROM behavioral_events WHERE session_id = $1`, [sid])).toHaveLength(0);
  expect((await db<{ decision: string }>(`SELECT decision FROM consent_records WHERE session_id = $1`, [sid]))[0]!.decision).toBe('declined');
  const pid = (await db<{ participant_id: string }>(`SELECT participant_id FROM experiment_sessions WHERE id = $1`, [sid]))[0]!.participant_id;

  await page.goto('/home');
  await page.getByText('Delete my data and leave the study').click();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page).toHaveURL(/\/\?deleted=1/);
  expect(await db(`SELECT 1 FROM participants WHERE id = $1`, [pid])).toHaveLength(0);
  expect(await db(`SELECT 1 FROM experiment_sessions WHERE participant_id = $1`, [pid])).toHaveLength(0);
  await page.goto('/home');
  await expect(page).toHaveURL(/\/signin/);
});
