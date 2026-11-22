// main/testing/src/real-db.ts
/**
 * Re-exports `describeRealDb` and `describeOwnerIsolation` from
 * `@bslt/server-system/testing/real-db`.
 */

export {
  baseConnectionString,
  createTestDatabase,
  describeOwnerIsolation,
  describeRealDb,
  realDbAvailable,
  type DescribeRealDbOptions,
  type OwnerIsolationCase,
  type RealDbSuite,
  type TestDatabase,
} from '@bslt/server-system/testing/real-db';
