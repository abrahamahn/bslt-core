// main/tools/scripts/db/seed.ts
/**
 * Database Seed Script
 *
 * Seeds the database with test data for development.
 * Run with: pnpm db:seed
 *
 * Environment variables are loaded via Node's native --env-file flag in package.json scripts.
 *
 * WARNING: This script is for DEVELOPMENT ONLY. It uses hardcoded test passwords
 * and will refuse to run in production environments.
 *
 * Default test users:
 * - admin@example.com / password123 (admin role)
 * - user@example.com / password123 (user role)
 * - demo@example.com / password123 (user role)
 */

import { canonicalizeEmail } from '@bslt/contract';
import { buildWorkerConnectionString, createDbClient } from '@bslt/db';
import { hashPassword } from '@bslt/identity/server';
import { initEnv } from '@bslt/server-system/config';

/** Supported user roles for seed data */
type SeedUserRole = 'admin' | 'user';

export interface SeedUser {
  email: string;
  password: string;
  username: string;
  firstName: string;
  lastName: string;
  role: SeedUserRole;
}

/**
 * WARNING: These are hardcoded test credentials for DEVELOPMENT ONLY.
 * Never use these passwords in production. The seed script will refuse
 * to run if NODE_ENV === 'production'.
 */
export const TEST_USERS: SeedUser[] = [
  {
    email: 'admin@example.com',
    password: 'password123',
    username: 'admin',
    firstName: 'Admin',
    lastName: 'User',
    role: 'admin',
  },
  {
    email: 'user@example.com',
    password: 'password123',
    username: 'testuser',
    firstName: 'Test',
    lastName: 'User',
    role: 'user',
  },
  {
    email: 'demo@example.com',
    password: 'password123',
    username: 'demo',
    firstName: 'Demo',
    lastName: 'User',
    role: 'user',
  },
];

/**
 * Seed the database with test user data.
 *
 * Uses DEFAULT_ARGON2_CONFIG from @bslt/auth for password hashing,
 * avoiding the need to load the full server AppConfig.
 *
 * @throws {Error} If NODE_ENV is 'production' (exits with code 1)
 * @throws {Error} If database connection or insert fails
 * @complexity O(n) where n = number of test users
 */
export async function seed(options: { readonly closeConnection?: boolean } = {}): Promise<void> {
  // Load + validate `config/env` files (prefers `.env.local` when present).
  await initEnv();

  // Safety check: refuse to seed in production
  if (process.env['NODE_ENV'] === 'production') {
    console.error('');
    console.error('ERROR: Cannot run seed script in production!');
    console.error('');
    console.error('This script uses hardcoded test passwords and is intended');
    console.error('for development environments only. Running this in production');
    console.error('would create accounts with known, insecure passwords.');
    console.error('');
    console.error('If you need to create initial users in production, use a');
    console.error('secure provisioning process with strong, unique passwords.');
    console.error('');
    process.exit(1);
  }

  console.log('🌱 Starting database seed...\n');

  const connectionString = buildWorkerConnectionString();
  const db = createDbClient(connectionString);
  const failures: string[] = [];

  try {
    console.log('📦 Seeding users...');

    for (const user of TEST_USERS) {
      try {
        const passwordHash = await hashPassword(user.password);
        const canonical = canonicalizeEmail(user.email);
        const sql = [
          'WITH upserted_user AS (',
          '  INSERT INTO identity_users (email, canonical_email, username, role, email_verified_at, email_verified)',
          '  VALUES ($1, $2, $4, $7, NOW(), true)',
          '  ON CONFLICT (email) DO UPDATE SET',
          '    canonical_email = EXCLUDED.canonical_email,',
          '    username = EXCLUDED.username,',
          '    email_verified_at = COALESCE(identity_users.email_verified_at, EXCLUDED.email_verified_at),',
          '    email_verified = true',
          '  RETURNING id',
          '),',
          'upserted_creds AS (',
          '  INSERT INTO identity_credentials (user_id, password_hash)',
          '  SELECT id, $3 FROM upserted_user',
          '  ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash',
          '),',
          'upserted_profile AS (',
          '  INSERT INTO identity_profiles (user_id, first_name, last_name)',
          '  SELECT id, $5, $6 FROM upserted_user',
          '  ON CONFLICT (user_id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name',
          '),',
          'upserted_lockout AS (',
          '  INSERT INTO identity_lockouts (user_id)',
          '  SELECT id FROM upserted_user',
          '  ON CONFLICT (user_id) DO NOTHING',
          ')',
          'SELECT id FROM upserted_user',
        ].join('\n');

        await db.execute({
          text: sql,
          values: [
            user.email,
            canonical,
            passwordHash,
            user.username,
            user.firstName,
            user.lastName,
            user.role,
          ],
        });

        console.log(`  ✓ ${user.email} (${user.role})`);
      } catch (error) {
        failures.push(user.email);
        console.error(`Error seeding user ${user.email}:`, error);
      }
    }

    if (failures.length > 0) {
      throw new Error(`Seed failed for ${String(failures.length)} user(s): ${failures.join(', ')}`);
    }

    console.log('\n✅ Database seeded successfully!\n');
    console.log('Test credentials:');
    console.log('  Email: admin@example.com');
    console.log('  Password: password123');
    console.log('');

    console.log('');
  } finally {
    // The CLI closes the pool so the process can exit; tests share the client.
    if (options.closeConnection === true) {
      await db.close();
    }
  }
}
