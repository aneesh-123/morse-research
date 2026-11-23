import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const DB = process.env.E2E_DATABASE_URL ?? 'postgres://postgres@localhost:5432/morse_e2e';

/**
 * End-to-end tests run the production build against a dedicated database.
 * Mobile projects emulate viewport, touch and user agent in Chromium; they are not physical devices.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 6 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'android-pixel7', use: { ...devices['Pixel 7'] } },
    { name: 'iphone13-emulated', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'ipad-emulated', use: { ...devices['iPad (gen 7)'], browserName: 'chromium' } },
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: DB,
      APP_URL: `http://localhost:${PORT}`,
      INSECURE_COOKIES: '1',
      EMAIL_DEV_LOG: '1',
      RATE_LIMIT_DISABLED: '1',
      STUDY_CONTACT_NAME: 'E2E Researcher',
      STUDY_CONTACT_EMAIL: 'e2e@example.org',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
