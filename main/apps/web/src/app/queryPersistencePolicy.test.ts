// main/apps/web/src/app/queryPersistencePolicy.test.ts
import { identityMeQueryKey } from '@bslt/identity/web';
import { describe, expect, test } from 'vitest';

import { installedModules } from '../generated/modules';

import { isPersistableQueryKey } from './queryPersistencePolicy';

const INSTALLED_MODULE_IDS: ReadonlySet<string> = new Set(installedModules.map((m) => m.id));

describe('isPersistableQueryKey', () => {
  test.each([
    [['user', 'me']],
    [['user', 'me', 'profile-completeness']],
    [[...identityMeQueryKey]],
    [['/api/users/me']],
    [['/api/users', 'abc']],
    [['users']],
  ])('excludes live current-user query %j', (queryKey) => {
    expect(isPersistableQueryKey(queryKey)).toBe(false);
  });

  // Sensitive user-scoped data must never sit on disk in IndexedDB.
  test.each([
    [['apiKeys']],
    [['sessions']],
    [['devices', 'list']],
    [['billing', 'status']],
    [['billing', 'usage']],
    [['notifications']],
    [['notifications', 'preferences']],
    [['legal', 'agreements']],
  ])('excludes sensitive user-scoped query %j', (queryKey) => {
    expect(isPersistableQueryKey(queryKey)).toBe(false);
  });

  test.each([
    [['tasks']],
    [['tasks', 'create']],
    [['tasks', 'unknown']],
    [['identity', 'me']],
    [['files']],
    [['files', 'getAvatar']],
  ])('denies installed module query without explicit persist: true (%j)', (queryKey) => {
    expect(isPersistableQueryKey(queryKey)).toBe(false);
  });

  test.each([[['tasks', 'list']], [['files', 'list']], [['orgs', 'list']]])(
    'persists allowlisted module query %j only when its owning module is installed',
    (queryKey) => {
      expect(isPersistableQueryKey(queryKey)).toBe(INSTALLED_MODULE_IDS.has(String(queryKey[0])));
    },
  );

  test.each([[['undeclared-feature', 'list']], [['admin', 'users']], [['activities', 'feed']]])(
    'denies undeclared query head %j by default (WEB-06)',
    (queryKey) => {
      expect(isPersistableQueryKey(queryKey)).toBe(false);
    },
  );

  test('denies queries with a non-string head segment', () => {
    expect(isPersistableQueryKey([42, 'user'])).toBe(false);
  });

  test('denies an empty query key', () => {
    expect(isPersistableQueryKey([])).toBe(false);
  });
});
