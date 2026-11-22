// tests/e2e/globalTeardown.ts
import { type FullConfig } from '@playwright/test';

/**
 * Global teardown for Playwright E2E tests.
 * Runs once after all test suites.
 */
async function globalTeardown(_config: FullConfig) {
  console.log('Global teardown starting...');

  // 1. Clean up global test data
  // 2. Close any remaining handles
}

export default globalTeardown;
