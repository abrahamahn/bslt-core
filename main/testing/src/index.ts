// main/testing/src/index.ts
/**
 * @bslt/testing: the testing kit.
 *
 * - `buildTestApp`: the production `buildApp()` on a test database, with fakes
 *   for the external ports.
 * - `buildTestServer`: the production HTTP server over mock services, for
 *   route-map suites without a database.
 * - `describeRealDb` and `describeOwnerIsolation` live in `@bslt/testing/real-db`
 *   (importing it probes the database; this root does not).
 * - Fakes for the kernel ports, and the one `createMockLogger`.
 */

export { buildTestApp } from './build-test-app';
export type {
  BuildTestAppOptions,
  ExtraRoutes,
  TestApp,
  TestAppFakes,
  TestPorts,
} from './build-test-app';

export { buildTestServer, registerTestRouteMap } from './test-server';
export type {
  CsrfMode,
  TestRouteRegistrationOptions,
  TestServer,
  TestServerOptions,
} from './test-server';

export { createTestConfig, mergeConfig, TEST_JWT_SECRET } from './config';
export type { DeepPartial } from './config';

export { createMockLogger } from './fakes/logger';
export type { MockLogger } from './fakes/logger';

export {
  createFakeCacheStats,
  createFakeEmailService,
  createFakeErrorTracker,
  createFakeNotificationService,
  createFakeSmsProvider,
  createFakeStorage,
  FAKE_STORAGE_ORIGIN,
} from './fakes/ports';
export type {
  FakeCacheStats,
  FakeEmailService,
  FakeErrorTracker,
  FakeNotificationService,
  FakeSmsProvider,
  FakeStorage,
} from './fakes/ports';

export { createMockDb, createMockEmailTemplates, createMockStorageProvider } from './fakes/mock-db';
export type { MockDbClient, MockEmailTemplates, MockStorageProvider } from './fakes/mock-db';

export {
  createAdminJwt,
  createAdminUser,
  createTestJwt,
  createTestUser,
  createUnverifiedUser,
} from './fixtures';
export type { TestJwtOptions, TestUser } from './fixtures';

export {
  buildAuthenticatedRequest,
  CSRF_TOKEN_PATH,
  getAllCookies,
  getCsrfToken,
  getResponseCookie,
  parseJsonResponse,
  withCsrf,
} from './http';
export type { AuthenticatedRequestOptions, CsrfTokenPair } from './http';

export { seedTestUser } from './seed';

export { runSubscriberTwice } from '@bslt/server-system/testing/subscribers';

export type { TestDatabase } from './database';
