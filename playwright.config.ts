import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4173/api/auth',
    reuseExistingServer: false,
    env: { HOST: '127.0.0.1', PORT: '4173', DB_PATH: join(tmpdir(), `mybudget-e2e-${process.pid}.sqlite`) },
  },
  projects: [
    { name: 'mobile', use: { ...devices['iPhone SE'], defaultBrowserType: 'chromium', viewport: { width: 360, height: 780 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],
});
