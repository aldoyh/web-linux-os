import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 20000,
  retries: 1,
  // The OS persists to one shared state file, so tests must run one at a time.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
  },
  webServer: {
    command: 'node serve.mjs',
    port: 3000,
    reuseExistingServer: false,
  },
});
