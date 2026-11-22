// main/testing/src/fixtures.ts
/**
 * Test user fixtures and access tokens signed with the test config's secret.
 */

import { createAccessToken } from '@bslt/identity/server';

import { TEST_JWT_SECRET } from './config';

// ============================================================================
// Test User Fixtures
// ============================================================================

export interface TestUser {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  emailVerified: boolean;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export function createTestUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: 'user-test-123',
    email: 'test@example.com',
    name: 'Test User',
    role: 'user',
    emailVerified: true,
    // Hash for password "TestPassword123!"
    passwordHash: '$argon2id$v=19$m=1024,t=1,p=1$dGVzdHNhbHQ$hash-placeholder-for-testing',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

export function createAdminUser(overrides: Partial<TestUser> = {}): TestUser {
  return createTestUser({
    id: 'admin-test-456',
    email: 'admin@example.com',
    name: 'Admin User',
    role: 'admin',
    ...overrides,
  });
}

export function createUnverifiedUser(overrides: Partial<TestUser> = {}): TestUser {
  return createTestUser({
    id: 'unverified-test-789',
    email: 'unverified@example.com',
    name: 'Unverified User',
    emailVerified: false,
    ...overrides,
  });
}

// ============================================================================
// JWT Test Helpers
// ============================================================================

export interface TestJwtOptions {
  userId?: string;
  email?: string;
  role?: 'user' | 'admin';
  expiresIn?: string | number;
}

/**
 * Create a valid JWT access token for authenticated route tests.
 * Uses the test config's JWT secret.
 */
export function createTestJwt(overrides: TestJwtOptions = {}): string {
  const user = createTestUser(overrides);
  return createAccessToken(
    overrides.userId ?? user.id,
    overrides.email ?? user.email,
    overrides.role ?? user.role,
    TEST_JWT_SECRET,
    overrides.expiresIn ?? '15m',
  );
}

/**
 * Create a valid admin JWT access token for admin route tests.
 */
export function createAdminJwt(overrides: TestJwtOptions = {}): string {
  const admin = createAdminUser(overrides);
  return createAccessToken(
    overrides.userId ?? admin.id,
    overrides.email ?? admin.email,
    'admin',
    TEST_JWT_SECRET,
    overrides.expiresIn ?? '15m',
  );
}
