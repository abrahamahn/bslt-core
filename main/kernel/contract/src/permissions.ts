// main/kernel/contract/src/permissions.ts
import { array, number, object, optional, record, string, type Infer } from '@bslt/schema';

const MAX_ORG_PERMISSION_BIT = 62;
const PERMISSION_KEY_PATTERN = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_.]*$/u;
const MIGRATION_KEY_PATTERN = /^[a-z][a-z0-9]*\/\d{4}_[a-z0-9_]+\.sql$/u;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

const tombstonedPermissionSchema = object({
  permission: string({ min: 1 }),
  bit: number({ int: true, min: 0, max: MAX_ORG_PERMISSION_BIT }),
});

const permissionLockfileSchema = object({
  orgPermissionBits: record(
    number({ int: true, min: 0, max: MAX_ORG_PERMISSION_BIT }),
    string({ min: 1 }),
  ),
  tombstoned: array(tombstonedPermissionSchema),
  migrations: optional(record(string({ min: 1 }), string({ min: 1 }))),
});

export type PermissionLockfile = Infer<typeof permissionLockfileSchema>;

export function validatePermissionLockfile(lockfile: PermissionLockfile): string[] {
  const problems: string[] = [];
  const seenBits = new Map<number, string>();
  const seenPermissions = new Set<string>();

  for (const [permission, bit] of Object.entries(lockfile.orgPermissionBits)) {
    if (!PERMISSION_KEY_PATTERN.test(permission)) {
      problems.push(
        `orgPermissionBits["${permission}"]: invalid permission key (expected "<module>.<action>")`,
      );
    }
    if (!Number.isInteger(bit) || bit < 0 || bit > MAX_ORG_PERMISSION_BIT) {
      problems.push(
        `orgPermissionBits["${permission}"]: bit ${String(bit)} must be an integer between 0 and ${String(MAX_ORG_PERMISSION_BIT)}`,
      );
      continue;
    }
    seenPermissions.add(permission);
    const existingOwner = seenBits.get(bit);
    if (existingOwner !== undefined) {
      problems.push(
        `orgPermissionBits["${permission}"]: bit ${String(bit)} is already assigned to "${existingOwner}"`,
      );
    } else {
      seenBits.set(bit, permission);
    }
  }

  for (const entry of lockfile.tombstoned) {
    if (!PERMISSION_KEY_PATTERN.test(entry.permission)) {
      problems.push(
        `tombstoned["${entry.permission}"]: invalid permission key (expected "<module>.<action>")`,
      );
    }
    if (!Number.isInteger(entry.bit) || entry.bit < 0 || entry.bit > MAX_ORG_PERMISSION_BIT) {
      problems.push(
        `tombstoned["${entry.permission}"]: bit ${String(entry.bit)} must be an integer between 0 and ${String(MAX_ORG_PERMISSION_BIT)}`,
      );
      continue;
    }
    if (seenPermissions.has(entry.permission)) {
      problems.push(
        `permission "${entry.permission}" is listed in both orgPermissionBits and tombstoned`,
      );
    }
    seenPermissions.add(entry.permission);
    const existingOwner = seenBits.get(entry.bit);
    if (existingOwner !== undefined) {
      problems.push(
        `tombstoned["${entry.permission}"]: bit ${String(entry.bit)} collides with "${existingOwner}"`,
      );
    } else {
      seenBits.set(entry.bit, `tombstoned:${entry.permission}`);
    }
  }

  const sortedBits = [...seenBits.keys()].sort((a, b) => a - b);
  for (let expected = 0; expected < sortedBits.length; expected += 1) {
    if (sortedBits[expected] !== expected) {
      problems.push(`permission bits must be contiguous from 0 (missing bit ${String(expected)})`);
      break;
    }
  }

  if (lockfile.migrations !== undefined) {
    for (const [key, sha] of Object.entries(lockfile.migrations)) {
      if (!MIGRATION_KEY_PATTERN.test(key)) {
        problems.push(
          `migrations["${key}"]: invalid migration label (expected "<source>/NNNN_<name>.sql")`,
        );
      }
      if (!SHA256_HEX_PATTERN.test(sha)) {
        problems.push(`migrations["${key}"]: invalid SHA-256 hex digest`);
      }
    }
  }

  return problems;
}

export function parsePermissionLockfile(raw: unknown): PermissionLockfile {
  const parsed = permissionLockfileSchema.parse(raw);
  const problems = validatePermissionLockfile(parsed);
  if (problems.length > 0) {
    throw new Error(`Invalid permission lockfile:\n${problems.join('\n')}`);
  }
  return parsed;
}

export function createOrgBitLookup(
  lockfile: PermissionLockfile,
): (permission: string) => number | undefined {
  const map = new Map<string, number>(Object.entries(lockfile.orgPermissionBits));
  return (permission: string): number | undefined => map.get(permission);
}
