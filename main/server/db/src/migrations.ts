// main/server/db/src/migrations.ts
import fs from 'fs/promises';
import path from 'path';

import { createRawDb, type RawDb } from './client';

export interface MigrationLogger {
  log(message?: unknown, ...optionalParams: unknown[]): void;
}

export interface RunSqlMigrationsOptions {
  connectionString: string;
  migrationsDir: string;
  logger?: MigrationLogger;
}

export interface RunSqlMigrationsWithDbOptions {
  db: RawDb;
  migrationsDir: string;
  logger?: MigrationLogger;
}

export interface MigrationRunResult {
  applied: string[];
  skipped: string[];
}

export async function runSqlMigrations({
  connectionString,
  migrationsDir,
  logger,
}: RunSqlMigrationsOptions): Promise<MigrationRunResult> {
  const db = createRawDb(connectionString);

  try {
    return await runSqlMigrationsWithDb({ db, migrationsDir, logger: logger ?? console });
  } finally {
    await db.close();
  }
}

export async function runSqlMigrationsWithDb({
  db,
  migrationsDir,
  logger = console,
}: RunSqlMigrationsWithDbOptions): Promise<MigrationRunResult> {
  logger.log('Starting database migrations...');
  logger.log(`Migration directory: ${migrationsDir}`);

  await db.raw(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const files = await fs.readdir(migrationsDir);
  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

  const appliedMigrations = await db.query<{ name: string }>({
    text: 'SELECT name FROM migrations',
    values: [],
  });
  const appliedNames = new Set(appliedMigrations.map((m) => m.name));
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of sqlFiles) {
    if (appliedNames.has(file)) {
      skipped.push(file);
      continue;
    }

    logger.log(`  Applying migration: ${file}`);
    const filePath = path.join(migrationsDir, file);
    const sqlContent = await fs.readFile(filePath, 'utf-8');

    await db.transaction(async (tx) => {
      await tx.raw(sqlContent);
      await tx.execute({
        text: 'INSERT INTO migrations (name) VALUES ($1)',
        values: [file],
      });
    });

    logger.log(`  Applied: ${file}`);
    applied.push(file);
  }

  if (applied.length === 0) {
    logger.log('All migrations already applied.');
  } else {
    logger.log(`\nApplied ${String(applied.length)} migration(s) successfully.`);
  }

  return { applied, skipped };
}
