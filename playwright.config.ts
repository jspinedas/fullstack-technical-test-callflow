import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 45000,
  expect: { timeout: 15000 },
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    screenshot: 'only-on-failure',
  },
});
