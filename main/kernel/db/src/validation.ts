// main/kernel/db/src/validation.ts
/**
 * Schema Validation
 *
 * Validates that required database tables exist before accepting requests.
 * Prevents cryptic "relation does not exist" errors in production.
 */

import { TABLES, type TableName } from './generated/tables';

import type { RawDb } from './client';

// ============================================================================
// Required Tables
// ============================================================================

/**
 * All tables the application needs: every table the migration sources create.
 * Derived from the database catalog (`pnpm bslt sync rows` writes
 * `./generated/tables.ts`), so a new table is required from the moment its
 * baseline creates it and nobody keeps this list.
 */
export const REQUIRED_TABLES: readonly TableName[] = TABLES;

export type RequiredTable = TableName;

// ============================================================================
// Types
// ============================================================================

export interface SchemaValidationResult {
  valid: boolean;
  missingTables: string[];
  existingTables: string[];
}

export class SchemaValidationError extends Error {
  constructor(public readonly missingTables: string[]) {
    super(
      `Database schema is incomplete. Missing tables: ${missingTables.join(', ')}. ` +
        `Run 'pnpm db:migrate' to create them (development).`,
    );
    this.name = 'SchemaValidationError';
  }
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Check which tables exist in the database
 */
export async function getExistingTables(db: RawDb): Promise<string[]> {
  const result = await db.raw<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );

  return result.map((row) => row.tablename);
}

/**
 * Validate that all required tables exist
 */
export async function validateSchema(db: RawDb): Promise<SchemaValidationResult> {
  const existingTables = await getExistingTables(db);
  const existingSet = new Set(existingTables);

  const missingTables = REQUIRED_TABLES.filter((table) => !existingSet.has(table));

  return {
    valid: missingTables.length === 0,
    missingTables,
    existingTables,
  };
}

/**
 * Validate schema and throw if incomplete.
 * Call this during app startup.
 */
export async function requireValidSchema(db: RawDb): Promise<void> {
  const result = await validateSchema(db);

  if (!result.valid) {
    throw new SchemaValidationError(result.missingTables);
  }
}
