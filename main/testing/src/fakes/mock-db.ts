// main/testing/src/fakes/mock-db.ts
/**
 * Mock doubles for the suites that run route maps without a database: a
 * chainable mock DB client, mock email templates and a mock storage provider.
 * Real-DB suites use the fakes in ./ports.ts instead.
 */

import { vi, type Mock } from 'vitest';

// Mock function type that is callable
type MockFn<T = unknown> = Mock<(...args: unknown[]) => T> & ((...args: unknown[]) => T);

// ============================================================================
// Mock Database Client Factory
// ============================================================================

export interface MockDbClient {
  raw: MockFn;
  execute: MockFn;
  insert: MockFn;
  select: MockFn;
  update: MockFn;
  delete: MockFn;
  query: {
    users: {
      findFirst: MockFn;
      findMany: MockFn;
    };
    refreshTokens: {
      findFirst: MockFn;
      findMany: MockFn;
    };
    refreshTokenFamilies: {
      findFirst: MockFn;
    };
    loginAttempts: {
      findMany: MockFn;
    };
    passwordResetTokens: {
      findFirst: MockFn;
    };
    emailVerificationTokens: {
      findFirst: MockFn;
    };
  };
}

export function createMockDb(): MockDbClient {
  const mockChain = () => ({
    values: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  });

  const mockSelectChain = () => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  });

  return {
    raw: vi.fn().mockResolvedValue([]) as MockFn,
    execute: vi.fn().mockResolvedValue([{ ['?column?']: 1 }]) as MockFn,
    insert: vi.fn().mockReturnValue(mockChain()) as MockFn,
    select: vi.fn().mockReturnValue(mockSelectChain()),
    update: vi.fn().mockReturnValue(mockChain()),
    delete: vi.fn().mockReturnValue(mockChain()),
    query: {
      users: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      refreshTokens: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      refreshTokenFamilies: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      loginAttempts: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      passwordResetTokens: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      emailVerificationTokens: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
  };
}

// ============================================================================
// Mock Email Templates Factory
// ============================================================================

export interface MockEmailTemplates {
  passwordReset: MockFn;
  magicLink: MockFn;
  emailVerification: MockFn;
  existingAccountRegistrationAttempt: MockFn;
  tokenReuseAlert: MockFn;
  newLoginAlert: MockFn;
  passwordChangedAlert: MockFn;
  emailChangedAlert: MockFn;
}

export function createMockEmailTemplates(): MockEmailTemplates {
  const template = {
    subject: 'Test Subject',
    html: '<p>Test</p>',
    text: 'Test',
    to: 'test@example.com',
  };
  return {
    passwordReset: vi.fn().mockReturnValue(template) as MockFn,
    magicLink: vi.fn().mockReturnValue(template) as MockFn,
    emailVerification: vi.fn().mockReturnValue(template) as MockFn,
    existingAccountRegistrationAttempt: vi.fn().mockReturnValue(template) as MockFn,
    tokenReuseAlert: vi.fn().mockReturnValue(template) as MockFn,
    newLoginAlert: vi.fn().mockReturnValue(template) as MockFn,
    passwordChangedAlert: vi.fn().mockReturnValue(template) as MockFn,
    emailChangedAlert: vi.fn().mockReturnValue(template) as MockFn,
  };
}

// ============================================================================
// Mock Storage Provider Factory
// ============================================================================

export interface MockStorageProvider {
  upload: MockFn;
  download: MockFn;
  delete: MockFn;
  exists: MockFn;
  getSignedUrl: MockFn;
  list: MockFn;
}

export function createMockStorageProvider(): MockStorageProvider {
  return {
    upload: vi.fn().mockResolvedValue({
      key: 'test-key',
      url: 'https://example.com/test-key',
    }),
    download: vi.fn().mockResolvedValue(Buffer.from('test content')),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    getSignedUrl: vi.fn().mockResolvedValue('https://example.com/signed-url'),
    list: vi.fn().mockResolvedValue([]),
  };
}
