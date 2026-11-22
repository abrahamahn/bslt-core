// config/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseActiveEnvAssignments } from '../main/tools/lib/env-file';
import { PATHS, REPO_ROOT } from '../main/tools/lib/paths';

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  for (const { key, value } of parseActiveEnvAssignments(readFileSync(filePath, 'utf8'))) {
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

function initPlaywrightEnv(): void {
  const rootDir = REPO_ROOT;
  const envDir = PATHS.envDir;
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';

  const envFiles = [
    path.join(envDir, `.env.${nodeEnv}`),
    path.join(envDir, '.env'),
    path.join(rootDir, `.env.${nodeEnv}`),
    path.join(rootDir, '.env'),
  ];

  for (const envFile of envFiles) {
    loadEnvFile(envFile);
  }
}

initPlaywrightEnv();

const CI = Boolean(process.env.CI);
const WEB_HOST = '127.0.0.1';
const API_HOST = '127.0.0.1';
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? '5173');
const API_PORT = Number(process.env.E2E_API_PORT ?? '8080');
const API_PROXY_TARGET = `http://${API_HOST}:${String(API_PORT)}`;
const WS_PROXY_TARGET = `ws://${API_HOST}:${String(API_PORT)}`;
const shouldReuseExistingServer = process.env.E2E_REUSE_SERVER === '1';

const shouldUseMockBilling = process.env.E2E_MOCK_BILLING !== '0';
const e2eAuthStrategies =
  process.env.E2E_AUTH_STRATEGIES ??
  (process.env.E2E_ENABLE_ADVANCED_AUTH === '1' ? 'local,magic,webauthn' : 'local');
const e2eAppName = process.env.VITE_APP_NAME ?? 'BSLT';
const apiServerEnv = [
  `HOST=${API_HOST}`,
  `API_PORT=${String(API_PORT)}`,
  `PORT=${String(API_PORT)}`,
  `AUTH_STRATEGIES=${e2eAuthStrategies}`,
  `APP_NAME="${e2eAppName}"`,
  `VITE_APP_NAME="${e2eAppName}"`,
  'RATE_LIMIT_WINDOW_MS=60000',
  'RATE_LIMIT_MAX=2000',
  ...(shouldUseMockBilling
    ? [
        'BILLING_PROVIDER=stripe',
        'STRIPE_SECRET_KEY=sk_test_mock_e2e',
        'STRIPE_PUBLISHABLE_KEY=pk_test_mock_e2e',
        'STRIPE_WEBHOOK_SECRET=whsec_mock_e2e',
      ]
    : []),
].join(' ');

if (!Number.isInteger(WEB_PORT) || WEB_PORT <= 0) {
  throw new Error(`Invalid E2E_WEB_PORT: ${String(process.env.E2E_WEB_PORT)}`);
}

if (!Number.isInteger(API_PORT) || API_PORT <= 0) {
  throw new Error(`Invalid E2E_API_PORT: ${String(process.env.E2E_API_PORT)}`);
}

if (process.env.E2E_BASE_URL === undefined) {
  process.env.E2E_BASE_URL = `http://${WEB_HOST}:${WEB_PORT}`;
}

export default defineConfig({
  testDir: PATHS.e2eSpecs,
  testMatch: /.*\.e2e\.(ts|tsx)/,
  globalSetup: PATHS.e2eGlobalSetup,
  globalTeardown: PATHS.e2eGlobalTeardown,
  outputDir: path.join(PATHS.e2e, 'reports', 'test-results'),
  reporter: CI
    ? [['github'], ['blob']]
    : [
        ['list'],
        ['html', { outputFolder: path.join(PATHS.e2e, 'reports', 'html'), open: 'never' }],
      ],
  fullyParallel: !CI,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,

  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  webServer: [
    {
      command: `VITE_APP_NAME="${e2eAppName}" VITE_API_URL= VITE_PROXY_TARGET=${API_PROXY_TARGET} VITE_PROXY_WS_TARGET=${WS_PROXY_TARGET} pnpm --filter @bslt/web exec vite --host ${WEB_HOST} --port ${WEB_PORT}`,
      port: WEB_PORT,
      timeout: 120_000,
      reuseExistingServer: shouldReuseExistingServer,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `${apiServerEnv} pnpm --filter @bslt/server dev`,
      port: API_PORT,
      timeout: 120_000,
      reuseExistingServer: shouldReuseExistingServer,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
