// main/shared/src/api/router.ts
/**
 * Central API Router
 *
 * Single source of truth for HTTP contract groups used by server and clients.
 * This composes domain contracts without changing runtime behavior.
 */

import {
  activitiesContract,
  adminContract,
  analyticsContract,
  apiKeysContract,
  authContract,
  billingContract,
  complianceContract,
  featureFlagsContract,
  filesContract,
  jobsContract,
  notificationsContract,
  searchContract,
  statusContract,
  supportContract,
  tasksContract,
  tenantsContract,
  usersContract,
  webhooksContract,
} from '../contracts';

import type { ContractRouter } from './api';

export const apiRouter = {
  activities: activitiesContract,
  admin: adminContract,
  analytics: analyticsContract,
  apiKeys: apiKeysContract,
  auth: authContract,
  billing: billingContract,
  compliance: complianceContract,
  featureFlags: featureFlagsContract,
  files: filesContract,
  jobs: jobsContract,
  notifications: notificationsContract,
  search: searchContract,
  status: statusContract,
  support: supportContract,
  tasks: tasksContract,
  tenants: tenantsContract,
  users: usersContract,
  webhooks: webhooksContract,
} as const satisfies ContractRouter;

export type ApiRouter = typeof apiRouter;
