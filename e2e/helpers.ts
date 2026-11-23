import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

export const DB_URL = process.env.E2E_DATABASE_URL ?? 'postgres://postgres@localhost:5432/morse_e2e';

export async function db<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

export function sessionIdFromUrl(page: Page): string {
  const m = page.url().match(/\/study\/([0-9a-f-]{36})/);
  if (!m) throw new Error(`not on a study page: ${page.url()}`);
  return m[1] as string;
}

/** Fails if the page can scroll horizontally (layout overflow). */
export async function expectNoHorizontalOverflow(page: Page, label: string) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, `horizontal overflow on ${label}`).toBeLessThanOrEqual(r.cw + 1);
}

/** Checks that visible answer buttons are at least 44x44 CSS px (touch target guidance). */
export async function expectTouchTargets(page: Page) {
  const sizes = await page.locator('button.answer, [data-testid="answer-idk"]').evaluateAll((els) =>
    els.map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; }),
  );
  for (const s of sizes) {
    expect(s.w).toBeGreaterThanOrEqual(44);
    expect(s.h).toBeGreaterThanOrEqual(44);
  }
}

export async function createProfile(page: Page, name: string, email?: string): Promise<string> {
  await page.goto('/');
  await page.getByRole('link', { name: 'Create your learner profile' }).click();
  await page.getByLabel('Nickname').fill(name);
  if (email) await page.getByLabel(/Email/).fill(email);
  await page.getByText('I am 18 years old or older').click();
  await page.getByRole('button', { name: 'Create profile' }).click();
  const code = (await page.getByTestId('recovery-code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[0-9A-Z-]{30}$/);
  await page.getByText(/I have saved my recovery code/).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/home/);
  return code;
}

export async function startAndConsent(page: Page) {
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/\/study\//);
  await expect(page.getByTestId('consent-agree')).toBeVisible();
  await expectNoHorizontalOverflow(page, 'consent');
  await page.getByTestId('consent-agree').click();
  await page.getByTestId('enable-audio').click();
  await expect(page.getByTestId('audio-ok')).toBeEnabled();
  await expectNoHorizontalOverflow(page, 'audio setup');
  await page.getByTestId('audio-ok').click();
}

export async function screening(page: Page, skip: boolean, rating = 3) {
  await expect(page.getByText('How much Morse code do you currently know?')).toBeVisible();
  await expectNoHorizontalOverflow(page, 'screening');
  if (skip) await page.getByTestId('skip-diagnostic').check();
  else await page.getByTestId('rating').fill(String(rating));
  await page.getByTestId('screening-continue').click();
}

export type Strategy = (target: string, options: string[], n: number) => string | null;

/**
 * Answers trials in the browser until the stage changes away from the given phases.
 * The correct target is looked up in the test database, purely to simulate learners.
 */
export async function answerTrials(page: Page, sessionId: string, phases: string[], strategy: Strategy, opts: { onTrial?: (pos: number) => Promise<void>; max?: number } = {}) {
  const seenIntros: string[] = [];
  let n = 0;
  for (;;) {
    // Phase intro / resume gate
    const phaseStart = page.getByTestId('phase-start');
    const practice = page.getByTestId('start-practice');
    const done = page.getByTestId('completion');
    const learningDone = page.getByText('Learning complete');
    await Promise.race([
      page.locator('button.answer:enabled').first().waitFor({ timeout: 30_000 }),
      phaseStart.waitFor({ timeout: 30_000 }),
      practice.waitFor({ timeout: 30_000 }),
      done.waitFor({ timeout: 30_000 }),
    ]).catch(() => undefined);
    if (await done.isVisible()) return { n, seenIntros };
    if (await phaseStart.isVisible()) {
      const st = await db<{ stage: string }>(`SELECT stage FROM experiment_sessions WHERE id = $1`, [sessionId]);
      const stagePhase = { diagnostic: 'diagnostic', learning: 'learning', final_assessment: 'final', retention_test: 'retention' }[st[0]!.stage as string];
      if (!stagePhase || !phases.includes(stagePhase)) return { n, seenIntros };
      await phaseStart.click();
      continue;
    }
    if (await practice.isVisible()) {
      const intros = await page.locator('[data-testid^="intro-"]').evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').slice(6)));
      seenIntros.push(...intros);
      await expect(practice).toBeEnabled({ timeout: 15_000 });
      await practice.click();
      continue;
    }
    if (await learningDone.isVisible()) continue;
    const s = await db<{ stage: string; current_position: number | null }>(`SELECT stage, current_position FROM experiment_sessions WHERE id = $1`, [sessionId]);
    const pos = s[0]?.current_position;
    if (!pos) return { n, seenIntros };
    const row = (await db<{ target: string; phase: string; options: string[] }>(`SELECT target, phase, options FROM trial_schedule WHERE session_id = $1 AND position = $2`, [sessionId, pos]))[0]!;
    if (!phases.includes(row.phase)) return { n, seenIntros };
    if (opts.onTrial) await opts.onTrial(pos);
    await expect(page.locator('button.answer').first()).toBeEnabled({ timeout: 15_000 });
    const choice = strategy(row.target, row.options, n);
    if (choice === null) await page.getByTestId('answer-idk').click();
    else await page.getByTestId(`answer-${choice}`).click();
    n++;
    if (row.phase === 'learning') {
      await expect(page.getByTestId('feedback')).toBeVisible();
      await page.getByTestId('next').click();
    } else {
      // wait for the trial to be saved and the next to load
      await expect.poll(async () => (await db<{ n: string }>(`SELECT count(*)::text AS n FROM trial_responses WHERE session_id = $1 AND position = $2`, [sessionId, pos]))[0]!.n).toBe('1');
    }
    if (opts.max && n >= opts.max) return { n, seenIntros };
  }
}
