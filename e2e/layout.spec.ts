import { expect, test } from '@playwright/test';
import { answerTrials, createProfile, expectNoHorizontalOverflow, expectTouchTargets, screening, sessionIdFromUrl, startAndConsent } from './helpers';

// Short layout check: public pages, consent, audio setup, screening and the first learning trials,
// without the full 72-trial journey. Runs on every project; it is the main check on the tablet project.
test('public pages and first study screens fit the viewport with large touch targets', async ({ page }, info) => {
  for (const path of ['/', '/start', '/signin', '/privacy']) {
    await page.goto(path);
    await expectNoHorizontalOverflow(page, path);
  }
  await createProfile(page, `Layout ${info.project.name}`);
  await expectNoHorizontalOverflow(page, 'home');
  await startAndConsent(page);
  await screening(page, true);
  const sid = sessionIdFromUrl(page);
  await expect(page.getByRole('heading', { name: 'Let’s learn' })).toBeVisible();
  await answerTrials(page, sid, ['learning'], (t) => t, {
    max: 3,
    onTrial: async () => {
      await expectNoHorizontalOverflow(page, 'learning trial');
      await expectTouchTargets(page);
    },
  });
});
