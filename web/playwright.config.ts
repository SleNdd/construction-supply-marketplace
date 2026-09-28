import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3100';
const origin = new URL(baseURL);
if (!['localhost', '127.0.0.1'].includes(origin.hostname) || origin.port !== '3100') {
  throw new Error('E2E требует изолированный локальный frontend на порту 3100.');
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run start -- --port 3100',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { API_INTERNAL_URL: process.env.API_INTERNAL_URL || 'http://localhost:4100', PUBLIC_ORIGIN: baseURL },
  },
});
