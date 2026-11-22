// main/kernel/contract/src/permissions.test.ts
import { describe, expect, it } from 'vitest';

import {
  createOrgBitLookup,
  parsePermissionLockfile,
  validatePermissionLockfile,
} from './permissions';

describe('permission lockfile helpers', () => {
  it('rejects malformed lockfile shapes, negative/overflow/duplicate/gap bits, and tombstoned collisions', () => {
    expect(() => parsePermissionLockfile(null)).toThrow();
    expect(() => parsePermissionLockfile({})).toThrow();
    expect(() =>
      parsePermissionLockfile({
        orgPermissionBits: { 'orgs.a': -1 },
        tombstoned: [],
      }),
    ).toThrow();
    expect(() =>
      parsePermissionLockfile({
        orgPermissionBits: { 'orgs.a': 63 },
        tombstoned: [],
      }),
    ).toThrow();

    expect(
      validatePermissionLockfile({
        orgPermissionBits: { 'orgs.a': 0, 'orgs.b': 0 },
        tombstoned: [],
      }).length,
    ).toBeGreaterThan(0);
    expect(
      validatePermissionLockfile({
        orgPermissionBits: { 'orgs.a': 0, 'orgs.b': 2 },
        tombstoned: [],
      }).length,
    ).toBeGreaterThan(0);
    expect(
      validatePermissionLockfile({
        orgPermissionBits: { 'orgs.a': 0 },
        tombstoned: [{ permission: 'orgs.a', bit: 1 }],
      }).length,
    ).toBeGreaterThan(0);
    expect(
      validatePermissionLockfile({
        orgPermissionBits: { 'orgs.a': 0, 'orgs.b': 1 },
        tombstoned: [{ permission: 'orgs.c', bit: 1 }],
      }).length,
    ).toBeGreaterThan(0);
    expect(
      validatePermissionLockfile({
        orgPermissionBits: { InvalidKey: 0 },
        tombstoned: [],
      }).length,
    ).toBeGreaterThan(0);
  });

  it('parses a valid lockfile with active and tombstoned bits and builds orgBitLookup', () => {
    const parsed = parsePermissionLockfile({
      orgPermissionBits: {
        'orgs.members.invite': 0,
        'billing.manage': 2,
      },
      tombstoned: [{ permission: 'orgs.legacy.removed', bit: 1 }],
    });
    expect(validatePermissionLockfile(parsed)).toEqual([]);

    const lookup = createOrgBitLookup(parsed);
    expect(lookup('orgs.members.invite')).toBe(0);
    expect(lookup('billing.manage')).toBe(2);
    expect(lookup('orgs.legacy.removed')).toBeUndefined();
    expect(lookup('missing.perm')).toBeUndefined();
  });
});
