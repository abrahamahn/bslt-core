// main/server/db/src/testing/index.ts
/**
 * Testing utilities for @bslt/db
 *
 * Exports mock database clients and test helpers for use in test files.
 */

export {
  asMockDb,
  createMockDb,
  createMockDbWithData,
  type MockDbClient,
  type MockDbClientAsDb,
} from './mocks';
