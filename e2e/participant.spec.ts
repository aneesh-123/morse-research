import { expect, test } from '@playwright/test';
import { answerTrials, createProfile, db, expectNoHorizontalOverflow, expectTouchTargets, screening, sessionIdFromUrl, startAndConsent } from './helpers';

const accurate = (t: string, _o: string[], n: number) => (n % 9 === 4 ? null : t); // mostly correct (IDK only where allowed)
const mostlyWrong = (t: string, o: string[], n: number) => (n % 5 === 0 ? t : (o.find((x) => x !== t) ?? null));

test.describe('participant journey', () => {
  test('skip diagnostic → 48 learning → frozen profile → 24 final → completion', async ({ page }, info) => {
    test.skip(info.project.name === 'ipad-emulated', 'tablet is covered by e2e/layout.spec.ts');
    await createProfile(page, `Skipper ${info.project.name}`);
    await expectNoHorizontalOverflow(page, 'home');
    await startAndConsent(page);
    await screening(page, true);
    const sid = sessionIdFromUrl(page);

    // Learning intro screen, then the first block introduces E and T.
    await expect(page.getByRole('heading', { name: 'Let’s learn' })).toBeVisible();
    await expectNoHorizontalOverflow(page, 'learning intro');
    const learning = await answerTrials(page, sid, ['learning'], (t, o, n) => (o.includes(t) && n % 7 !== 3 ? t : (o.find((x) => x !== t) as string)), {
      onTrial: async (pos) => {
        if (pos === 1 || pos === 30) {
          await expectNoHorizontalOverflow(page, `learning trial ${pos}`);
          await expectTouchTargets(page);
        }
      },
    });
    expect(learning.n).toBe(48);
    expect(learning.seenIntros).toEqual(['E', 'T', 'A', 'N', 'I', 'M']);

    // Final test: no replay control, IDK present, 6 options, no feedback.
    await expect(page.getByRole('heading', { name: 'Final challenge' })).toBeVisible();
    await page.getByTestId('phase-start').click();
    await expect(page.locator('button.answer')).toHaveCount(6);
    await expect(page.getByTestId('replay')).toHaveCount(0);
    await expect(page.getByTestId('answer-idk')).toBeVisible();
    await expectNoHorizontalOverflow(page, 'final test');
    await expectTouchTargets(page);
    const fin = await answerTrials(page, sid, ['final'], accurate);
    expect(fin.n).toBe(24);
    await expect(page.getByTestId('completion')).toBeVisible();
    await expectNoHorizontalOverflow(page, 'completion');
    await expect(page.getByTestId('feedback')).toHaveCount(0);

    const s = (await db<{ stage: string; baseline_status: string; device_category: string }>(`SELECT * FROM experiment_sessions WHERE id = $1`, [sid]))[0]!;
    expect(s.stage).toBe('completed');
    expect(s.baseline_status).toBe('not_tested_self_reported_beginner');
    const counts = await db<{ phase: string; n: string }>(`SELECT phase, count(*)::text AS n FROM trial_responses WHERE session_id = $1 GROUP BY phase`, [sid]);
    expect(Object.fromEntries(counts.map((c) => [c.phase, Number(c.n)]))).toEqual({ learning: 48, final: 24 });
    const order = (await db<{ ok: boolean }>(
      `SELECT (SELECT created_at FROM knowledge_profiles WHERE session_id = $1) <= (SELECT min(received_at) FROM trial_responses WHERE session_id = $1 AND phase = 'final') AS ok`, [sid],
    ))[0]!;
    expect(order.ok).toBe(true);
    // Timing fields are populated and sane.
    const timing = (await db<{ bad: string; nulls: string; rt_min: number }>(
      `SELECT count(*) FILTER (WHERE invalid_timing)::text AS bad, count(*) FILTER (WHERE rt_ms IS NULL OR playback_end_observed_ms IS NULL)::text AS nulls, min(rt_ms) AS rt_min FROM trial_responses WHERE session_id = $1`, [sid],
    ))[0]!;
    expect(timing.bad).toBe('0');
    expect(timing.nulls).toBe('0');
    expect(timing.rt_min).toBeGreaterThan(0);
    // Telemetry arrived with ordered sequence numbers and screen summaries.
    await expect.poll(async () => Number((await db<{ n: string }>(`SELECT count(*)::text AS n FROM behavioral_events WHERE session_id = $1 AND type = 'session_completed'`, [sid]))[0]!.n)).toBe(1);
    const types = await db<{ type: string; n: string }>(`SELECT type, count(*)::text AS n FROM behavioral_events WHERE session_id = $1 GROUP BY type`, [sid]);
    const t = Object.fromEntries(types.map((r) => [r.type, Number(r.n)]));
    expect(t.trial_presented).toBe(72);
    expect(t.answer_selected).toBe(72);
    expect(t.feedback_displayed).toBe(48);
    expect(t.audio_played).toBe(72);
    expect(t.screen_exit).toBeGreaterThan(10);
    const dupSeq = await db(`SELECT client_load_id, seq FROM behavioral_events WHERE session_id = $1 GROUP BY 1, 2 HAVING count(*) > 1`, [sid]);
    expect(dupSeq).toHaveLength(0);
    const isMobile = info.project.name !== 'desktop-chrome';
    expect(s.device_category).toBe(isMobile ? 'mobile' : 'desktop');

    // Home shows the completed session and no new Day-1 session.
    await page.getByRole('link', { name: 'Go to my profile' }).click();
    await expect(page.getByText('Thank you for taking part')).toBeVisible();
    await expect(page.getByText('Completed')).toBeVisible();
  });

  test('diagnostic + struggling learner still reaches all six letters and completes', async ({ page }, info) => {
    test.skip(info.project.name !== 'iphone13-emulated' && info.project.name !== 'desktop-chrome', 'run on one phone and one desktop project');
    await createProfile(page, 'Struggler');
    await startAndConsent(page);
    await screening(page, false, 2);
    const sid = sessionIdFromUrl(page);
    await expect(page.getByRole('heading', { name: 'Quick check' })).toBeVisible();
    await page.getByTestId('phase-start').click();
    await expect(page.getByTestId('replay')).toHaveCount(0);
    await expect(page.locator('button.answer')).toHaveCount(6);
    const d = await answerTrials(page, sid, ['diagnostic'], (_t, _o, n) => (n % 2 ? null : 'E'));
    expect(d.n).toBe(12);
    const l = await answerTrials(page, sid, ['learning'], mostlyWrong);
    expect(l.n).toBe(48);
    expect(l.seenIntros).toEqual(['E', 'T', 'A', 'N', 'I', 'M']);
    await page.getByTestId('phase-start').click();
    const f = await answerTrials(page, sid, ['final'], mostlyWrong);
    expect(f.n).toBe(24);
    await expect(page.getByTestId('completion')).toBeVisible();
    const s = (await db<{ baseline_status: string; prior_knowledge_rating: number }>(`SELECT * FROM experiment_sessions WHERE id = $1`, [sid]))[0]!;
    expect(s).toMatchObject({ baseline_status: 'tested', prior_knowledge_rating: 2 });
    const prof = (await db<{ profile: { characters: { category: string }[] } }>(`SELECT profile FROM knowledge_profiles WHERE session_id = $1`, [sid]))[0]!;
    expect(prof.profile.characters).toHaveLength(6);
  });
});
