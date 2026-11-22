// tests/e2e/fixtures/auth.ts
import { argon2, createHash, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

import { SIGNUP_AGREEMENT_DOCUMENT_TYPES } from '@bslt/compliance/contract';
import { REFRESH_TOKEN_COOKIE_NAME } from '@bslt/contract';
import { createPgPool, type PgSql } from '@bslt/protocols/pg';
import { expect, type Page } from '@playwright/test';

const deriveArgon2 = promisify(argon2);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const tag = await deriveArgon2('argon2id', {
    message: password,
    nonce: salt,
    memory: 19456,
    passes: 2,
    parallelism: 1,
    tagLength: 32,
  });
  const unpadded = (bytes: Buffer): string => bytes.toString('base64').replace(/=+$/u, '');
  return `$argon2id$v=19$m=19456,t=2,p=1$${unpadded(salt)}$${unpadded(tag)}`;
}

export interface E2eUserCredentials {
  email: string;
  password: string;
  role?: 'admin' | 'moderator' | 'user';
}

export type E2eTenantRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface E2eTenantMembership {
  email: string;
  role: E2eTenantRole;
  isBillingAdmin?: boolean;
}

export interface E2eTenantOptions {
  name: string;
  slug: string;
  ownerEmail: string;
  members: E2eTenantMembership[];
}

export interface CreateE2eUserOptions {
  email?: string;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
  password?: string;
  role?: 'admin' | 'moderator' | 'user';
  username?: string;
}

const POSTGRES_FALLBACK_PORTS = [5432, 5433, 5434] as const;
const DEFAULT_PASSWORD = 'Passw0rd!Secure';
const FEATURE_HINT_KEYS = [
  'activities',
  'audit',
  'billing',
  'dashboard',
  'files',
  'profile',
  'settings',
  'tasks',
] as const;

function makeConnectionString(port: number): string {
  if (process.env['DATABASE_URL'] !== undefined && process.env['DATABASE_URL'] !== '') {
    return process.env['DATABASE_URL'];
  }

  const user = process.env['POSTGRES_USER'] ?? process.env['DB_USER'] ?? 'postgres';
  const password = process.env['POSTGRES_PASSWORD'] ?? process.env['DB_PASSWORD'] ?? '';
  const host = process.env['POSTGRES_HOST'] ?? process.env['DB_HOST'] ?? 'localhost';
  const database = process.env['POSTGRES_DB'] ?? process.env['DB_NAME'] ?? 'app_dev';
  const auth = password !== '' ? `${user}:${password}` : user;
  return `postgres://${auth}@${host}:${String(port)}/${database}`;
}

async function resolveE2eConnectionString(): Promise<string> {
  if (process.env['DATABASE_URL'] !== undefined && process.env['DATABASE_URL'] !== '') {
    return process.env['DATABASE_URL'];
  }

  const envPort = Number(process.env['POSTGRES_PORT'] ?? process.env['DB_PORT'] ?? NaN);
  const ports = [...new Set([envPort, ...POSTGRES_FALLBACK_PORTS].filter(Number.isFinite))];

  for (const port of ports) {
    const connectionString = makeConnectionString(port);
    const sql = createPgPool(connectionString, {
      connect_timeout: 1,
      idle_timeout: 1,
      max: 1,
    });
    try {
      await sql`SELECT 1`;
      await sql.end({ timeout: 1 });
      return connectionString;
    } catch {
      await sql.end({ timeout: 1 }).catch(() => undefined);
    }
  }

  throw new Error(`Unable to connect to Postgres on ports: ${ports.join(', ')}`);
}

function uniqueSlug(prefix: string): string {
  const suffix = `${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
  return `${prefix}-${suffix}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

function tenantSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function createE2eUser(
  prefix = 'e2e',
  options: CreateE2eUserOptions = {},
): E2eUserCredentials {
  const slug = uniqueSlug(prefix);
  return {
    email: options.email ?? `${slug}@example.com`,
    password: options.password ?? DEFAULT_PASSWORD,
    role: options.role ?? 'user',
  };
}

/**
 * Record a seeded user's consent to the latest published signup agreements
 * (Terms of Service, Privacy Policy), the way every real signup path does
 * (`insertConsentedUser` in @bslt/core). A user inserted straight into `users`
 * has no such rows, so once a ToS is published (the legal-template migration
 * publishes version 1) the ToS gate answers its requests with 403
 * TOS_ACCEPTANCE_REQUIRED. The gate is left as it is: this gives seeded users
 * the consent evidence real users have. Idempotent per document.
 *
 * @param sql - A connection that may write `consent_records` (the e2e
 *   fixtures connect as the database owner)
 * @param userId - The seeded user
 */
export async function acceptPublishedSignupAgreements(sql: PgSql, userId: string): Promise<void> {
  await sql.unsafe(
    `
      INSERT INTO compliance_consents (user_id, record_type, document_id, ip_address, user_agent)
      SELECT $1, 'legal_document', latest.id, '127.0.0.1', 'e2e-seed'
      FROM (
        SELECT DISTINCT ON (type) id, type
        FROM compliance_legal_documents
        WHERE type = ANY($2::text[])
        ORDER BY type, version DESC
      ) AS latest
      WHERE NOT EXISTS (
        SELECT 1 FROM compliance_consents existing
        WHERE existing.user_id = $1
          AND existing.record_type = 'legal_document'
          AND existing.document_id = latest.id
      )
    `,
    [userId, [...SIGNUP_AGREEMENT_DOCUMENT_TYPES]],
  );
}

export async function seedE2eUser(
  credentials: E2eUserCredentials,
  options: Omit<CreateE2eUserOptions, 'email' | 'password' | 'role'> = {},
): Promise<string> {
  const connectionString = await resolveE2eConnectionString();
  const sql = createPgPool(connectionString, { max: 1 });
  const canonicalEmail = credentials.email.trim().toLowerCase();
  const emailVerified = options.emailVerified ?? true;
  const username =
    options.username ??
    canonicalEmail
      .split('@')[0]
      ?.replace(/[^a-zA-Z0-9_]/g, '_')
      .slice(0, 48) ??
    uniqueSlug('e2e_user');
  // The server's own hasher, at its default argon2id parameters (19456 KiB, t=2, p=1).
  const passwordHash = await hashPassword(credentials.password);

  try {
    const result = await sql.unsafe(
      `
        WITH upserted_user AS (
          INSERT INTO identity_users
            (email, canonical_email, username, role, email_verified, email_verified_at)
          VALUES
            ($1, $2, $4, $7, $8, CASE WHEN $8 THEN NOW() END)
          ON CONFLICT (canonical_email) DO UPDATE SET
            email = EXCLUDED.email,
            username = EXCLUDED.username,
            role = EXCLUDED.role,
            email_verified = EXCLUDED.email_verified,
            email_verified_at = CASE
              WHEN EXCLUDED.email_verified THEN COALESCE(identity_users.email_verified_at, NOW())
            END,
            last_username_change = NULL,
            deactivated_at = NULL,
            deleted_at = NULL,
            deletion_grace_period_ends = NULL,
            updated_at = NOW()
          RETURNING id
        ),
        upserted_creds AS (
          INSERT INTO identity_credentials (user_id, password_hash, totp_secret, totp_enabled)
          SELECT id, $3, NULL, false FROM upserted_user
          ON CONFLICT (user_id) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            totp_secret = NULL,
            totp_enabled = false,
            updated_at = NOW()
        ),
        upserted_profile AS (
          INSERT INTO identity_profiles (user_id, first_name, last_name, avatar_url)
          SELECT id, $5, $6, NULL FROM upserted_user
          ON CONFLICT (user_id) DO UPDATE SET
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            avatar_url = NULL,
            updated_at = NOW()
        ),
        upserted_lockout AS (
          INSERT INTO identity_lockouts (user_id, locked_until, lock_reason, failed_login_attempts)
          SELECT id, NULL, NULL, 0 FROM upserted_user
          ON CONFLICT (user_id) DO UPDATE SET
            locked_until = NULL,
            lock_reason = NULL,
            failed_login_attempts = 0,
            updated_at = NOW()
        )
        SELECT id FROM upserted_user
      `,
      [
        credentials.email,
        canonicalEmail,
        passwordHash,
        username,
        options.firstName ?? 'E2E',
        options.lastName ?? 'User',
        credentials.role ?? 'user',
        emailVerified,
      ],
    );
    const id = result[0]?.['id'];
    if (typeof id !== 'string') {
      throw new Error(`Failed to seed E2E user ${credentials.email}`);
    }
    await sql.unsafe(`DELETE FROM identity_login_attempts WHERE email = $1`, [credentials.email]);
    // Like a real signup: consent to the published agreements, or the ToS
    // gate refuses this user's requests.
    await acceptPublishedSignupAgreements(sql, id);
    return id;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export async function ensureVerifiedE2eUser(
  credentials: E2eUserCredentials,
  options: Omit<CreateE2eUserOptions, 'email' | 'password' | 'role' | 'emailVerified'> = {},
): Promise<string> {
  return seedE2eUser(credentials, { ...options, emailVerified: true });
}

/**
 * Seed failed login attempts so the next login hits the real lockout
 * (default LOCKOUT_MAX_ATTEMPTS = 10 within the lockout window).
 */
export async function seedFailedLoginAttempts(email: string, count: number): Promise<void> {
  const connectionString = await resolveE2eConnectionString();
  const sql = createPgPool(connectionString, { max: 1 });
  try {
    // Only credential failures (USER_NOT_FOUND / PASSWORD_MISMATCH) count
    // toward the lockout window — other reasons are ignored by the counter.
    await sql.unsafe(
      `
        INSERT INTO identity_login_attempts (email, ip_address, user_agent, success, failure_reason)
        SELECT $1, '127.0.0.1', 'e2e-lockout', false, 'PASSWORD_MISMATCH'
        FROM generate_series(1, $2::int)
      `,
      [email, count],
    );
  } finally {
    await sql.end({ timeout: 1 });
  }
}

/**
 * Create a real email-verification token for a seeded user. Mirrors the
 * server's scheme: 32 random bytes (hex) stored as a SHA-256 hex hash in
 * auth_tokens. Returns the plain token for use in /auth/confirm-email URLs.
 */
export async function createEmailVerificationToken(email: string): Promise<string> {
  const connectionString = await resolveE2eConnectionString();
  const sql = createPgPool(connectionString, { max: 1 });
  const canonicalEmail = email.trim().toLowerCase();
  const plain = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(plain).digest('hex');

  try {
    const rows = await sql.unsafe(`SELECT id FROM identity_users WHERE canonical_email = $1`, [
      canonicalEmail,
    ]);
    const userId = rows[0]?.['id'];
    if (typeof userId !== 'string') {
      throw new Error(`Cannot create verification token: user ${email} was not found`);
    }
    await sql.unsafe(
      `
        INSERT INTO identity_auth_tokens (type, user_id, email, token_hash, expires_at)
        VALUES ('email_verification', $1, $2, $3, NOW() + INTERVAL '1 hour')
      `,
      [userId, canonicalEmail, hash],
    );
    return plain;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export async function ensureE2eTenant(options: E2eTenantOptions): Promise<string> {
  const connectionString = await resolveE2eConnectionString();
  const sql = createPgPool(connectionString, { max: 1 });
  const ownerCanonicalEmail = options.ownerEmail.trim().toLowerCase();
  const slug = tenantSlug(options.slug);

  try {
    const ownerRows = await sql.unsafe(`SELECT id FROM identity_users WHERE canonical_email = $1`, [
      ownerCanonicalEmail,
    ]);
    const ownerId = ownerRows[0]?.['id'];
    if (typeof ownerId !== 'string') {
      throw new Error(`Cannot seed tenant ${slug}: owner ${options.ownerEmail} was not found`);
    }

    const tenantRows = await sql.unsafe(
      `
        INSERT INTO orgs (name, slug, owner_id, is_active)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          owner_id = EXCLUDED.owner_id,
          is_active = true,
          updated_at = NOW()
        RETURNING id
      `,
      [options.name, slug, ownerId],
    );
    const tenantId = tenantRows[0]?.['id'];
    if (typeof tenantId !== 'string') {
      throw new Error(`Failed to seed tenant ${slug}`);
    }

    const members = options.members.some(
      (member) => member.email.trim().toLowerCase() === ownerCanonicalEmail,
    )
      ? options.members
      : [{ email: options.ownerEmail, role: 'owner' as const }, ...options.members];

    for (const member of members) {
      const canonicalEmail = member.email.trim().toLowerCase();
      const userRows = await sql.unsafe(
        `SELECT id FROM identity_users WHERE canonical_email = $1`,
        [canonicalEmail],
      );
      const userId = userRows[0]?.['id'];
      if (typeof userId !== 'string') {
        throw new Error(`Cannot seed tenant member ${member.email}: user was not found`);
      }

      await sql.unsafe(
        `
          INSERT INTO orgs_members (org_id, user_id, role)
          VALUES ($1, $2, $3)
          ON CONFLICT (org_id, user_id) DO UPDATE SET
            role = EXCLUDED.role,
            updated_at = NOW()
        `,
        [tenantId, userId, member.role],
      );
    }

    return tenantId;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

/**
 * Make the `flags.*` rows of the run's database match this run's toggles, in one
 * transaction: delete every `flags.*` row (its org overrides go with it, ON DELETE
 * CASCADE), then insert the enabled flags, untargeted (no allow-list, no rollout).
 * Reconciling at setup, not restoring in globalTeardown, keeps a run correct after a
 * killed one or a hand edit, and a run with no toggle set gets the manifest defaults.
 *
 * @returns The flag keys this run turned on
 */
export async function syncE2eRuntimeFlags(
  flags: Readonly<Record<`flags.${string}`, boolean>>,
): Promise<string[]> {
  const enabledKeys = Object.entries(flags)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
  const sql = createPgPool(await resolveE2eConnectionString(), { max: 1 });

  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`DELETE FROM flags WHERE key LIKE 'flags.%'`);
      await tx.unsafe(
        `
          INSERT INTO flags (key, description, is_enabled)
          SELECT key, 'Turned on by the e2e run (E2E_ENABLE_*)', true
          FROM unnest($1::text[]) AS key
        `,
        [enabledKeys],
      );
    });
    return enabledKeys;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export async function loginViaUi(
  page: Page,
  credentials: E2eUserCredentials,
  baseURL: string,
  returnTo?: string,
): Promise<void> {
  await prepareE2ePage(page);
  const loginUrl = new URL('/login', baseURL);
  const expectedReturnPath =
    returnTo !== undefined && returnTo.length > 0 ? new URL(returnTo, baseURL).pathname : undefined;
  if (returnTo !== undefined && returnTo.length > 0) {
    loginUrl.searchParams.set('returnTo', returnTo);
  }
  await page.goto(loginUrl.toString());
  await page
    .getByLabel(/email|username/i)
    .first()
    .fill(credentials.email);
  await page
    .getByLabel(/^password$/i)
    .first()
    .fill(credentials.password);
  await page
    .getByRole('button', { name: /^sign in$/i })
    .first()
    .click();

  await page.waitForURL(
    (url) =>
      expectedReturnPath !== undefined
        ? url.pathname === expectedReturnPath
        : /\/(?:admin|dashboard|settings|tasks)(?:[/?#]|$)/i.test(
            `${url.pathname}${url.search}${url.hash}`,
          ),
    {
      timeout: 15_000,
    },
  );

  await expect
    .poll(
      async () => {
        const cookies = await page.context().cookies(baseURL);
        return cookies.some((cookie) => cookie.name === REFRESH_TOKEN_COOKIE_NAME);
      },
      { timeout: 5_000 },
    )
    .toBe(true);
  // The signed-in header: the top bar shows the account menu only for an
  // authenticated session. (It no longer prints the email or a Logout button;
  // both moved inside this menu.)
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible({
    timeout: 10_000,
  });
  await prepareE2ePage(page);
}

export async function createAndLoginE2eUser(
  page: Page,
  baseURL: string,
  prefix = 'e2e',
  options: CreateE2eUserOptions = {},
): Promise<E2eUserCredentials> {
  const credentials = createE2eUser(prefix, options);
  await ensureVerifiedE2eUser(credentials, options);
  await loginViaUi(page, credentials, baseURL);
  return credentials;
}
export async function prepareE2ePage(page: Page): Promise<void> {
  await page
    .context()
    .addInitScript((hintKeys: readonly string[]) => {
      window.localStorage.setItem('cookie-consent-dismissed', 'true');
      for (const key of hintKeys) {
        window.localStorage.setItem('abe:hint:' + key, 'true');
      }
    }, FEATURE_HINT_KEYS)
    .catch(() => undefined);
  await page
    .evaluate((hintKeys: readonly string[]) => {
      window.localStorage.setItem('cookie-consent-dismissed', 'true');
      for (const key of hintKeys) {
        window.localStorage.setItem('abe:hint:' + key, 'true');
      }
      const isVisible = (element: Element): boolean => {
        const htmlElement = element as HTMLElement;
        const style = window.getComputedStyle(htmlElement);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          htmlElement.getClientRects().length > 0
        );
      };
      for (const root of [
        ...document.querySelectorAll('[data-testid="cookie-consent-banner"]'),
        ...document.querySelectorAll('.feature-hint-callout'),
      ]) {
        for (const button of root.querySelectorAll('button')) {
          const label = button.textContent ?? '';
          if (/reject non-essential|accept all|got it/i.test(label) && isVisible(button)) {
            (button as HTMLButtonElement).click();
          }
        }
      }
    }, FEATURE_HINT_KEYS)
    .catch(() => undefined);
}
