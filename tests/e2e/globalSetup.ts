// tests/e2e/globalSetup.ts
import { type FullConfig } from '@playwright/test';

import {
  ensureE2eTenant,
  ensureVerifiedE2eUser,
  syncE2eRuntimeFlags,
  type E2eUserCredentials,
} from './fixtures/auth';
import { e2eRuntimeFlags } from './fixtures/capabilities';

/**
 * Global setup for Playwright E2E tests.
 * Runs once before all test suites.
 */
async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'unknown-base-url';
  console.log(`Global setup starting for ${baseURL}...`);

  const seededUsers: E2eUserCredentials[] = [
    { email: 'admin@example.com', password: 'AdminPass123!', role: 'admin' },
    { email: 'user@example.com', password: 'UserPass123!', role: 'user' },
    { email: 'billing-user@example.com', password: 'BillingPassw0rd!', role: 'user' },
    { email: 'notif-user@example.com', password: 'NotifPassw0rd!', role: 'user' },
    { email: 'email-test@example.com', password: 'EmailTestPassw0rd!', role: 'user' },
    { email: 'viewer@example.com', password: 'ViewerPassw0rd!', role: 'user' },
    { email: 'tenant-admin@example.com', password: 'TenantAdminPassw0rd!', role: 'user' },
  ];

  await Promise.all(seededUsers.map((user) => ensureVerifiedE2eUser(user)));

  await ensureE2eTenant({
    name: 'E2E SaaS Tenant',
    slug: 'e2e-saas-tenant',
    ownerEmail: 'admin@example.com',
    members: [
      { email: 'admin@example.com', role: 'owner', isBillingAdmin: true },
      { email: 'tenant-admin@example.com', role: 'admin', isBillingAdmin: true },
      { email: 'user@example.com', role: 'member' },
      { email: 'viewer@example.com', role: 'viewer' },
    ],
  });

  const enabledFlags = await syncE2eRuntimeFlags(e2eRuntimeFlags);
  console.log(
    `Runtime flags on: ${enabledFlags.length > 0 ? enabledFlags.join(', ') : 'none: manifest defaults'}`,
  );
}

export default globalSetup;
