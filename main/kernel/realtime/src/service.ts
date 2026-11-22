// main/kernel/realtime/src/service.ts
/**
 * Realtime Service
 *
 * Server-side service for loading and saving realtime records.
 * Handles database operations, the table policy registry, and optimistic locking.
 * Pure operation logic (apply, conflict detection) lives in `./operations`.
 *
 * The record API is a generic proxy onto database tables, so this module is
 * the whole of its authorization. It is deny-by-default: no table is
 * registered out of the box, and a table can only be registered with a
 * {@link RealtimeTablePolicy} naming the columns it exposes, the fields it
 * accepts and the column that ties each row to its owning user.
 *
 * @module service
 */

import { selectOwnedRealtimeRows, updateOwnedRealtimeRow, type DbClient } from '@bslt/db';

import {
  applyOperation,
  applyOperations,
  checkVersionConflicts,
  getOperationPointers,
  isFieldMutable,
  PROTECTED_FIELDS,
  REALTIME_ERRORS,
  type RealtimeRecord,
  type RecordMap,
  type RecordPointer,
} from './operations';

import type { RealtimeTablePolicy } from './types';

export {
  applyOperation,
  applyOperations,
  checkVersionConflicts,
  getOperationPointers,
  isFieldMutable,
};

// ============================================================================
// Table Policy Registry
// ============================================================================

/** Plain SQL identifier: what every table and column name in a policy must be. */
const SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** Identifiers that are valid SQL but would collide with object prototype keys. */
const BLOCKED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Registered policies, keyed by logical table name. Empty by default: the
 * `users` table used to be registered here with no policy at all, which let
 * any signed-in user read every user's password hash and rewrite their role.
 */
const tablePolicies = new Map<string, RealtimeTablePolicy>();

function assertIdentifier(kind: string, name: string): void {
  if (!SQL_IDENTIFIER.test(name) || BLOCKED_OBJECT_KEYS.has(name)) {
    throw new Error(`Invalid realtime ${kind} name: ${name}`);
  }
}

/**
 * Register a table for realtime operations under an explicit access policy.
 * Call this during application setup; a table that is never registered stays
 * unreachable through the realtime API.
 *
 * @param table - Logical table name clients use in pointers and operations
 * @param policy - Readable columns, writable fields and owner column for the table
 * @throws Error if a name is not a plain identifier, the table is already
 *   registered, `id`/`version` are not readable, or a writable field is
 *   unreadable, protected, or the owner column
 * @complexity O(r + w) for r readable columns and w writable fields
 */
export function registerRealtimeTable(table: string, policy: RealtimeTablePolicy): void {
  assertIdentifier('table', table);
  assertIdentifier('database table', policy.tableName);
  assertIdentifier('owner column', policy.ownerColumn);
  policy.readableColumns.forEach((column) => {
    assertIdentifier('column', column);
  });
  if (tablePolicies.has(table)) {
    throw new Error(`Realtime table '${table}' is already registered`);
  }

  const readable = new Set(policy.readableColumns);
  for (const required of ['id', 'version']) {
    if (!readable.has(required)) {
      throw new Error(`Realtime table '${table}': readable columns must include '${required}'`);
    }
  }
  for (const field of policy.writableFields) {
    if (!readable.has(field)) {
      throw new Error(`Realtime table '${table}': writable field '${field}' must be readable`);
    }
    if (PROTECTED_FIELDS.has(field)) {
      throw new Error(`Realtime table '${table}': field '${field}' is protected`);
    }
    if (field === policy.ownerColumn) {
      throw new Error(`Realtime table '${table}': the owner column cannot be writable`);
    }
  }

  // Copy and freeze so the caller cannot widen the policy after registration.
  tablePolicies.set(
    table,
    Object.freeze({
      tableName: policy.tableName,
      readableColumns: Object.freeze([...readable]),
      writableFields: Object.freeze([...new Set(policy.writableFields)]),
      ownerColumn: policy.ownerColumn,
    }),
  );
}

function policyFor(table: string): RealtimeTablePolicy {
  const policy = tablePolicies.get(table);
  if (policy === undefined) {
    throw new Error(REALTIME_ERRORS.tableNotAllowed(table));
  }
  return policy;
}

/**
 * Check if a table is registered for realtime operations.
 *
 * @param table - Table name to check
 * @returns Whether the table has a registered policy
 * @complexity O(1)
 */
export function isTableAllowed(table: string): boolean {
  return tablePolicies.has(table);
}

/**
 * Check if an operation key may be written on a table. The key's root segment
 * (`prefs` in `prefs.theme`) must be one of the policy's writable fields.
 *
 * @param table - Logical table name
 * @param key - Operation key, optionally a dot-separated path
 * @returns Whether the table is registered and the key's root field is writable
 * @complexity O(w) for w writable fields
 */
export function isFieldWritable(table: string, key: string): boolean {
  const rootKey = key.split('.')[0] ?? '';
  return tablePolicies.get(table)?.writableFields.includes(rootKey) ?? false;
}

/**
 * Resolve a logical table name to its database table identifier.
 * Returns undefined if the table is not registered for realtime operations.
 *
 * @param logicalName - Logical table name
 * @returns Database table name, or undefined if not registered
 * @complexity O(1)
 */
export function resolveTableName(logicalName: string): string | undefined {
  return tablePolicies.get(logicalName)?.tableName;
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Load the caller's records by pointers. Only rows whose owner column equals
 * `userId` are selected, and only the policy's readable columns leave the
 * database; a pointer to someone else's row comes back exactly as a missing
 * one does.
 *
 * @param db - Database client
 * @param pointers - Array of table/id pairs to load
 * @param userId - Authenticated user the rows must belong to
 * @returns Record map with loaded records organized by table
 * @throws Error if `userId` is empty or a table is not registered
 * @complexity O(t) database queries where t is the number of distinct tables
 */
export async function loadRecords(
  db: DbClient,
  pointers: RecordPointer[],
  userId: string,
): Promise<RecordMap> {
  const recordMap = Object.create(null) as RecordMap;
  if (pointers.length === 0) {
    return recordMap;
  }
  if (userId === '') {
    throw new Error('Realtime record access requires a user id');
  }

  // Group pointers by table, deduplicating ids - O(n) where n = pointers.length
  const byTable = new Map<string, Set<string>>();
  for (const pointer of pointers) {
    policyFor(pointer.table);
    const ids = byTable.get(pointer.table) ?? new Set<string>();
    ids.add(pointer.id);
    byTable.set(pointer.table, ids);
  }

  for (const [table, ids] of byTable.entries()) {
    const policy = policyFor(table);
    const tableRecords = Object.create(null) as Record<string, RealtimeRecord>;
    recordMap[table] = tableRecords;

    const rows = await selectOwnedRealtimeRows<RealtimeRecord>(db, {
      tableName: policy.tableName,
      readableColumns: policy.readableColumns,
      ownerColumn: policy.ownerColumn,
      userId,
      ids: Array.from(ids),
    });

    for (const row of rows) {
      // Project again: the response is built from these objects, so a column
      // the policy did not name must not survive even if the driver returns it.
      tableRecords[row.id] = Object.fromEntries(
        policy.readableColumns.map((column) => [column, row[column]]),
      ) as RealtimeRecord;
    }
  }

  return recordMap;
}

/**
 * Save the caller's updated records with optimistic locking. Only the policy's
 * writable fields are persisted, and the UPDATE is bound to the record id, the
 * version it was loaded at and the caller as owner. Realtime never creates rows.
 *
 * @param db - Database client
 * @param recordMap - Record map with updated records
 * @param originalRecordMap - Record map as loaded (for version checking)
 * @param userId - Authenticated user the rows must belong to
 * @throws Error if a table is not registered, a record was not loaded first,
 *   or no owned row matched the expected version
 * @complexity O(r) database operations where r is the number of changed records
 */
export async function saveRecords(
  db: DbClient,
  recordMap: RecordMap,
  originalRecordMap: RecordMap,
  userId: string,
): Promise<void> {
  for (const [table, records] of Object.entries(recordMap)) {
    const policy = policyFor(table);

    for (const [id, record] of Object.entries(records)) {
      const originalRecord = originalRecordMap[table]?.[id];
      if (originalRecord === undefined) {
        throw new Error(`Realtime cannot create records: ${table}:${id}`);
      }
      if (record.version > originalRecord.version) {
        const updated = await updateRecord(db, policy, record, originalRecord.version, userId);
        if (!updated) {
          throw new Error(`Concurrent modification detected for ${table}:${id}`);
        }
      }
    }
  }
}

/**
 * Update an existing record with optimistic locking and an ownership guard.
 *
 * @param db - Database client
 * @param policy - Policy of the record's table
 * @param record - Updated record data
 * @param expectedVersion - Version the record was loaded at
 * @param userId - Authenticated user the row must belong to
 * @returns Whether exactly one owned row at the expected version was updated
 * @complexity O(w) to build the statement for w writable fields, one database operation
 */
async function updateRecord(
  db: DbClient,
  policy: RealtimeTablePolicy,
  record: RealtimeRecord,
  expectedVersion: number,
  userId: string,
): Promise<boolean> {
  // Client values, whatever their shape: set() binds every value that is not a
  // fragment made by the builder, and nothing a client sends can be one.
  const writable = Object.fromEntries(
    policy.writableFields
      .filter((field) => Object.hasOwn(record, field))
      .map((field) => [field, record[field]]),
  );

  return updateOwnedRealtimeRow(db, {
    tableName: policy.tableName,
    ownerColumn: policy.ownerColumn,
    userId,
    id: record.id,
    expectedVersion,
    nextVersion: record.version,
    writable,
    updatedAt: new Date(),
  });
}
