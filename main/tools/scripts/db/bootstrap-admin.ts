// main/tools/scripts/db/bootstrap-admin.ts
/**
 * Production Admin Bootstrap Script
 *
 * Creates the initial admin user for first deployment.
 * Generates a secure random password that must be changed on first login.
 *
 * Usage:
 *   pnpm db:bootstrap:admin
 *
 * Environment variables:
 *   ADMIN_EMAIL - Admin email (default: admin@localhost)
 *   ADMIN_NAME  - Admin display name (default: Administrator)
 *
 * This script is SAFE for production:
 * - Generates cryptographically secure random password
 * - Will not overwrite existing admin user
 * - Outputs credentials only once (save them!)
 */

import { randomInt } from 'crypto';

import { canonicalizeEmail } from '@bslt/contract';
import { buildWorkerConnectionString, createDbClient, eq, insert, select } from '@bslt/db';
import { hashPassword } from '@bslt/identity/server';

interface BootstrapResult {
  email: string;
  password: string;
  created: boolean;
}

/**
 * Generate a cryptographically secure random password
 *
 * @param length - Password length in characters
 * @returns A random password string using alphanumeric + special characters
 * @complexity O(n) where n = length
 */
function generateSecurePassword(length = 24): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars[randomInt(chars.length)];
  }

  return password;
}

/**
 * Bootstrap the initial admin user in the database.
 *
 * Uses DEFAULT_ARGON2_CONFIG from @bslt/auth for password hashing,
 * avoiding the need to load the full server AppConfig.
 *
 * @returns Bootstrap result with email, generated password, and creation status
 * @throws {Error} If database connection or query fails
 * @complexity O(1) — single DB read + conditional write
 */
export async function bootstrapAdmin(): Promise<BootstrapResult> {
  const envEmail = process.env['ADMIN_EMAIL'];
  const email = envEmail !== undefined && envEmail !== '' ? envEmail : 'admin@localhost';
  const envName = process.env['ADMIN_NAME'];
  const name = envName !== undefined && envName !== '' ? envName : 'Administrator';

  console.log('🔐 Production Admin Bootstrap\n');
  console.log('Creating initial admin user...\n');

  const connectionString = buildWorkerConnectionString();
  const db = createDbClient(connectionString);

  const IDENTITY_USERS_TABLE = 'identity_users';
  // Check if admin already exists
  const existing = await db.query<Record<string, unknown>>(
    select(IDENTITY_USERS_TABLE).where(eq('email', email)).limit(1).toSql(),
  );

  if (existing.length > 0) {
    console.log(`⚠️  Admin user already exists: ${email}`);
    console.log('   No changes made. Use password reset if needed.\n');
    return { email, password: '', created: false };
  }

  // Generate secure random password
  const password = generateSecurePassword();
  const passwordHash = await hashPassword(password);

  // Create admin user across identity_users + credentials + profiles + lockouts
  const canonical = canonicalizeEmail(email);
  const verifiedAt = new Date();
  const insertUserSql = insert(IDENTITY_USERS_TABLE)
    .values({
      email,
      canonical_email: canonical,
      username: 'admin',
      role: 'admin',
      email_verified: true,
      email_verified_at: verifiedAt,
    })
    .toSql();
  await db.execute({
    text: `WITH created_admin AS (${insertUserSql.text} RETURNING id),
           created_creds AS (
             INSERT INTO identity_credentials (user_id, password_hash)
             SELECT id, $${String(insertUserSql.values.length + 1)} FROM created_admin
           ),
           created_profile AS (
             INSERT INTO identity_profiles (user_id, first_name, last_name)
             SELECT id, $${String(insertUserSql.values.length + 2)}, '' FROM created_admin
           ),
           created_lockout AS (
             INSERT INTO identity_lockouts (user_id)
             SELECT id FROM created_admin
           )
           SELECT id FROM created_admin`,
    values: [...insertUserSql.values, passwordHash, name],
  });

  console.log('✅ Admin user created successfully!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  SAVE THESE CREDENTIALS - SHOWN ONLY ONCE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('⚠️  Change this password immediately after first login!\n');

  return { email, password, created: true };
}
