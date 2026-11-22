// main/kernel/realtime/src/operations.ts
/**
 * Realtime Domain
 *
 * API contract definitions and pure domain logic for real-time record operations.
 * Supports optimistic locking with version-based conflict detection.
 *
 * @module Domain/Realtime
 */

import {
  array,
  discriminated,
  literal,
  number,
  object,
  optional,
  record,
  string,
  union,
  unknown,
  uuidSchema,
} from '@bslt/schema';

import type { Schema } from '@bslt/schema';

function isSafeObjectKey(key: string): boolean {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!(key in objB)) return false;
      if (!deepEqual(objA[key], objB[key])) return false;
    }
    return true;
  }

  return false;
}

function getFieldValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    if (!Object.hasOwn(current, part)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ============================================================================
// Types
// ============================================================================

/** Set a field value on a record */
export interface RealtimeSetOperation {
  type: 'set';
  table: string;
  id: string;
  key: string;
  value: unknown;
}

/** Set a field to current timestamp (server-side) */
export interface RealtimeSetNowOperation {
  type: 'set-now';
  table: string;
  id: string;
  key: string;
}

/** Position specification for list insert operations */
type ListPosition = 'prepend' | 'append' | { before: unknown } | { after: unknown };

/** Insert a value into a list field */
export interface RealtimeListInsertOperation {
  type: 'listInsert';
  table: string;
  id: string;
  key: string;
  value: unknown;
  position: ListPosition;
}

/** Remove a value from a list field */
export interface RealtimeListRemoveOperation {
  type: 'listRemove';
  table: string;
  id: string;
  key: string;
  value: unknown;
}

/** Union of all operation types */
export type RealtimeOperation =
  | RealtimeSetOperation
  | RealtimeSetNowOperation
  | RealtimeListInsertOperation
  | RealtimeListRemoveOperation;

/** A transaction containing multiple operations to apply atomically */
export interface RealtimeTransaction {
  /** Unique transaction ID (for idempotency and tracking) */
  txId: string;
  /** User ID performing the transaction */
  authorId: string;
  /** Operations to apply */
  operations: RealtimeOperation[];
  /** Client-side timestamp (for ordering) */
  clientTimestamp: number;
}

/** Points to a specific record by table and ID */
export interface RecordPointer<T extends string = string> {
  table: T;
  id: string;
}

/** Base interface for versioned records (id + version) */
interface VersionedRecord {
  id: string;
  version: number;
}

/** A record with required id and version fields */
export interface RealtimeRecord extends VersionedRecord {
  [key: string]: unknown;
}

/** Map of table -> id -> record */
export type RecordMap = Record<string, Record<string, RealtimeRecord>>;

/** Success response with updated records */
interface WriteResponse {
  recordMap: RecordMap;
}

/** Conflict response (409) */
interface ConflictResponse {
  message: string;
  conflictingRecords?: RecordPointer[] | undefined;
}

/** Get records response */
interface GetRecordsResponse {
  recordMap: RecordMap;
}

/** Request for fetching records by pointers */
export interface GetRecordsRequest {
  pointers: RecordPointer[];
}

/** Result of applying operations to a record map. */
export interface ApplyOperationsResult {
  /** Updated record map */
  recordMap: RecordMap;
  /** Records that were modified (for publishing) */
  modifiedRecords: ReadonlyArray<{ table: string; id: string }>;
}

/**
 * Version conflict error details.
 * Returned when optimistic locking detects a concurrent modification.
 */
export interface VersionConflict {
  /** Table name */
  table: string;
  /** Record ID */
  id: string;
  /** Version the client expected */
  expectedVersion: number;
  /** Actual version in the database */
  actualVersion: number;
}

// ============================================================================
// Type Aliases (Sprint 7.1)
// ============================================================================

// ============================================================================
// Constants
// ============================================================================

/**
 * Fields that cannot be modified through realtime operations.
 * These are system-managed fields that must be protected.
 *
 * @complexity O(1) lookup
 */
export const PROTECTED_FIELDS = new Set<string>([
  'id',
  'version',
  'created_at',
  'updated_at',
  'password_hash',
  'passwordHash',
]);

/**
 * Domain-specific error messages for realtime operations.
 * Generic errors (auth, internal) use `ERROR_CODES` from `@bslt/contract`.
 */
export const REALTIME_ERRORS = {
  AUTHOR_MISMATCH: 'Author ID must match authenticated user',
  tableNotAllowed: (table: string) => `Table '${table}' is not allowed for realtime operations`,
  VERSION_CONFLICT: 'Version conflict: one or more records have been modified',
} as const;

// ============================================================================
// Schemas
// ============================================================================

const nonEmptyTableSchema = string({ min: 1, label: 'table' });
const nonEmptyKeySchema = string({ min: 1, label: 'key' });
const positiveIntSchema = (label: string): Schema<number> => number({ int: true, min: 1, label });

/** @complexity O(1) */
export const setOperationSchema: Schema<RealtimeSetOperation> = object(
  {
    type: literal('set'),
    table: nonEmptyTableSchema,
    id: uuidSchema,
    key: nonEmptyKeySchema,
    value: unknown(),
  },
  { unknownKeys: 'strip' },
);

/** @complexity O(1) */
export const setNowOperationSchema: Schema<RealtimeSetNowOperation> = object(
  {
    type: literal('set-now'),
    table: nonEmptyTableSchema,
    id: uuidSchema,
    key: nonEmptyKeySchema,
  },
  { unknownKeys: 'strip' },
);

/** @complexity O(1) */
export const listPositionSchema: Schema<ListPosition> = union([
  literal('prepend'),
  literal('append'),
  object({ before: unknown() }),
  object({ after: unknown() }),
]);

/** @complexity O(1) */
export const listInsertOperationSchema: Schema<RealtimeListInsertOperation> = object(
  {
    type: literal('listInsert'),
    table: nonEmptyTableSchema,
    id: uuidSchema,
    key: nonEmptyKeySchema,
    value: unknown(),
    position: listPositionSchema,
  },
  { unknownKeys: 'strip' },
);

/** @complexity O(1) */
export const listRemoveOperationSchema: Schema<RealtimeListRemoveOperation> = object(
  {
    type: literal('listRemove'),
    table: nonEmptyTableSchema,
    id: uuidSchema,
    key: nonEmptyKeySchema,
    value: unknown(),
  },
  { unknownKeys: 'strip' },
);

/** @complexity O(1) */
export const operationSchema: Schema<RealtimeOperation> = discriminated('type', [
  setOperationSchema,
  setNowOperationSchema,
  listInsertOperationSchema,
  listRemoveOperationSchema,
]);

/** @complexity O(n) where n = operations.length */
export const transactionSchema: Schema<RealtimeTransaction> = object(
  {
    txId: uuidSchema,
    authorId: uuidSchema,
    operations: array(operationSchema, { min: 1 }),
    clientTimestamp: positiveIntSchema('clientTimestamp'),
  },
  { unknownKeys: 'strip' },
);

/** @complexity O(1) */
export const recordPointerSchema: Schema<RecordPointer> = object(
  {
    table: nonEmptyTableSchema,
    id: uuidSchema,
  },
  { unknownKeys: 'strip' },
);

/** @complexity O(1) */
export const recordSchema: Schema<RealtimeRecord> = object(
  {
    id: uuidSchema,
    version: positiveIntSchema('version'),
  },
  { unknownKeys: 'passthrough' },
);

/** @complexity O(t * r) where t = tables, r = records per table */
export const recordMapSchema: Schema<RecordMap> = record(record(recordSchema));

/** @complexity O(t * r) where t = tables, r = records per table */
export const writeResponseSchema: Schema<WriteResponse> = object(
  {
    recordMap: recordMapSchema,
  },
  { unknownKeys: 'strip' },
);

/** @complexity O(c) where c = conflictingRecords.length */
export const conflictResponseSchema: Schema<ConflictResponse> = object(
  {
    message: string({ label: 'message' }),
    conflictingRecords: optional(array(recordPointerSchema)),
  },
  { unknownKeys: 'strip' },
);

/** @complexity O(t * r) where t = tables, r = records per table */
export const getRecordsResponseSchema: Schema<GetRecordsResponse> = object(
  {
    recordMap: recordMapSchema,
  },
  { unknownKeys: 'strip' },
);

/** @complexity O(n) where n = pointers.length */
export const getRecordsRequestSchema: Schema<GetRecordsRequest> = object(
  {
    pointers: array(recordPointerSchema, { min: 1, max: 100 }),
  },
  { unknownKeys: 'strip' },
);

// ============================================================================
// Functions
// ============================================================================

/**
 * Check if a field can be modified through realtime operations.
 *
 * @param field - Field name to check
 * @returns Whether the field is mutable (not protected)
 * @complexity O(1)
 */
export function isFieldMutable(field: string): boolean {
  return !PROTECTED_FIELDS.has(field);
}

/**
 * Set a nested value on an object by dot-separated path.
 * Creates intermediate objects if they do not exist.
 *
 * @param obj - Target object (mutated in place)
 * @param path - Dot-separated path (e.g., "settings.theme.color")
 * @param value - Value to set at the path
 * @complexity O(d) where d is the depth of the path
 */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  const lastKey = keys.pop();
  if (lastKey === undefined || lastKey === '') return;
  if (!isSafeObjectKey(lastKey)) return;

  let target: Record<string, unknown> = obj;
  for (const key of keys) {
    if (!isSafeObjectKey(key)) return;
    const existing = Object.hasOwn(target, key) ? target[key] : undefined;
    if (existing === undefined || existing === null || typeof existing !== 'object') {
      const nested: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      target[key] = nested;
      target = nested;
    } else {
      target = existing as Record<string, unknown>;
    }
  }

  target[lastKey] = value;
}

/**
 * Apply a set operation to a record.
 */
function applySetOp(record: RealtimeRecord, op: RealtimeSetOperation): void {
  setPath(record, op.key, op.value);
}

/**
 * Apply a set-now operation to a record (sets current ISO timestamp).
 */
function applySetNowOp(record: RealtimeRecord, op: RealtimeSetNowOperation): void {
  setPath(record, op.key, new Date().toISOString());
}

/**
 * Apply a list insert operation to a record.
 * Removes duplicates before inserting at the specified position.
 */
function applyListInsertOp(record: RealtimeRecord, op: RealtimeListInsertOperation): void {
  const currentValue = getFieldValue(record, op.key);
  const list = Array.isArray(currentValue) ? [...(currentValue as unknown[])] : [];

  // Remove duplicates first
  const filtered = list.filter((item) => !deepEqual(item, op.value));

  const position: ListPosition = op.position;

  if (position === 'prepend') {
    setPath(record, op.key, [op.value, ...filtered]);
  } else if (position === 'append') {
    setPath(record, op.key, [...filtered, op.value]);
  } else if ('before' in position) {
    const index = filtered.findIndex((item) => deepEqual(item, position.before));
    filtered.splice(index >= 0 ? index : 0, 0, op.value);
    setPath(record, op.key, filtered);
  } else if ('after' in position) {
    const index = filtered.findIndex((item) => deepEqual(item, position.after));
    filtered.splice(index + 1, 0, op.value);
    setPath(record, op.key, filtered);
  }
}

/**
 * Apply a list remove operation to a record.
 */
function applyListRemoveOp(record: RealtimeRecord, op: RealtimeListRemoveOperation): void {
  const currentValue = getFieldValue(record, op.key);
  if (!Array.isArray(currentValue)) {
    return;
  }

  setPath(
    record,
    op.key,
    currentValue.filter((item) => !deepEqual(item, op.value)),
  );
}

/**
 * Apply a single operation to a record.
 * Creates a new record with incremented version.
 *
 * @param record - Source record to apply the operation to
 * @param op - The operation to apply
 * @returns New record with the operation applied and version incremented
 * @throws Error if the operation targets a protected field
 * @complexity O(d) where d is the depth of the key path
 */
export function applyOperation(record: RealtimeRecord, op: RealtimeOperation): RealtimeRecord {
  // Validate field is mutable (all operations have a key field)
  const key = op.key;
  const rootKey: string | undefined = key.split('.')[0];
  if (rootKey === undefined || rootKey === '' || !isFieldMutable(rootKey)) {
    throw new Error(`Field '${rootKey ?? key}' cannot be modified`);
  }

  const newRecord: RealtimeRecord = {
    ...record,
    version: record.version + 1,
  };

  switch (op.type) {
    case 'set':
      applySetOp(newRecord, op);
      break;

    case 'set-now':
      applySetNowOp(newRecord, op);
      break;

    case 'listInsert':
      applyListInsertOp(newRecord, op);
      break;

    case 'listRemove':
      applyListRemoveOp(newRecord, op);
      break;
  }

  return newRecord;
}

/**
 * Apply all operations to a record map.
 * Returns the new record map and list of modified records.
 *
 * Clone-on-write: only records targeted by an operation are deep cloned;
 * untouched tables and records are shared by reference with the input map,
 * which is never mutated.
 *
 * @param recordMap - Source record map (never mutated)
 * @param operations - Operations to apply sequentially
 * @returns New record map and list of modified record pointers
 * @throws Error if a record referenced by an operation does not exist
 * @complexity O(t + n * (d + s)) where t = tables, n = operations, d = max key
 *   depth, and s = size of each touched record (cloned once on first touch)
 */
export function applyOperations(
  recordMap: RecordMap,
  operations: RealtimeOperation[],
): ApplyOperationsResult {
  // Share all tables by reference; touched tables are copied on first write
  const newRecordMap: RecordMap = Object.create(null) as RecordMap;
  for (const [table, records] of Object.entries(recordMap)) {
    // Use defineProperty to prevent prototype pollution via dynamic keys
    Object.defineProperty(newRecordMap, table, {
      value: records,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  const clonedTables = new Set<string>();
  const modifiedKeys = new Set<string>();
  const modifiedRecords: RecordPointer[] = [];

  for (const op of operations) {
    // All operation types have table and id fields - extract them safely
    const table = op.table;
    const id = op.id;

    if (!isSafeObjectKey(table) || !isSafeObjectKey(id)) {
      throw new Error(`Invalid table or id: ${table}:${id}`);
    }

    let tableRecords = newRecordMap[table];
    if (tableRecords?.[id] === undefined) {
      throw new Error(`Record not found: ${table}:${id}`);
    }

    // Copy the table container on first write so the source map stays intact
    if (!clonedTables.has(table)) {
      tableRecords = Object.assign(
        Object.create(null) as Record<string, RealtimeRecord>,
        tableRecords,
      );
      Object.defineProperty(newRecordMap, table, {
        value: tableRecords,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      clonedTables.add(table);
    }

    // Deep clone the record on first touch; setPath mutates nested objects,
    // so the record must be detached from the source map before applying ops
    const key = `${table}:${id}`;
    const existing = tableRecords[id];
    if (existing === undefined) {
      throw new Error(`Record not found: ${table}:${id}`);
    }
    const record = modifiedKeys.has(key)
      ? existing
      : (JSON.parse(JSON.stringify(existing)) as RealtimeRecord);

    const newRecord = applyOperation(record, op);
    Object.defineProperty(tableRecords, id, {
      value: newRecord,
      writable: true,
      enumerable: true,
      configurable: true,
    });

    if (!modifiedKeys.has(key)) {
      modifiedKeys.add(key);
      modifiedRecords.push({ table, id });
    }
  }

  return { recordMap: newRecordMap, modifiedRecords };
}

/**
 * Extract unique record pointers from operations.
 * Deduplicates by table:id key.
 *
 * @param operations - Array of realtime operations
 * @returns Deduplicated array of record pointers
 * @complexity O(n) where n is the number of operations
 */
export function getOperationPointers(operations: RealtimeOperation[]): RecordPointer[] {
  const seen = new Set<string>();
  const pointers: RecordPointer[] = [];

  for (const op of operations) {
    const table = op.table;
    const id = op.id;
    const key = `${table}:${id}`;
    if (!seen.has(key)) {
      seen.add(key);
      pointers.push({ table, id });
    }
  }

  return pointers;
}

/**
 * Check for version conflicts between original and current records.
 * Used during optimistic locking to detect concurrent modifications.
 *
 * @param originalRecordMap - Record map at the start of the transaction
 * @param currentRecordMap - Record map reloaded during the transaction
 * @param modifiedRecords - Records that were modified by the current transaction
 * @returns Array of version conflicts (empty if no conflicts)
 * @complexity O(m) where m is the number of modified records
 */
export function checkVersionConflicts(
  originalRecordMap: RecordMap,
  currentRecordMap: RecordMap,
  modifiedRecords: RecordPointer[],
): VersionConflict[] {
  const conflicts: VersionConflict[] = [];

  for (const { table, id } of modifiedRecords) {
    const original = originalRecordMap[table]?.[id];
    const current = currentRecordMap[table]?.[id];

    if (original !== undefined && current !== undefined) {
      const originalVersion = original.version;
      const currentVersion = current.version;

      // Original version should match current DB version
      if (originalVersion !== currentVersion) {
        conflicts.push({
          table,
          id,
          expectedVersion: originalVersion,
          actualVersion: currentVersion,
        });
      }
    }
  }

  return conflicts;
}
