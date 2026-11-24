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
 * Seed the database with test user data (and optional rich SaaS demo scenario).
 *
 * Uses `hashPassword` from `@bslt/identity/server` (default Argon2id config),
 * avoiding the need to load the full server AppConfig.
 *
 * @throws {Error} If NODE_ENV is 'production' (exits with code 1)
 * @throws {Error} If database connection or insert fails
 * @complexity O(n) where n = number of test users
 */
export const DEMO_BILLING_PLANS = [
  {
    id: 'plan_free_monthly',
    name: 'Free',
    description: 'Core workspace features for solo builders.',
    interval: 'month',
    priceInCents: 0,
    currency: 'usd',
    trialDays: 0,
    sortOrder: 0,
    features: [
      { key: 'projects', name: 'Projects', included: true, value: 3 },
      { key: 'storage', name: 'Storage (GB)', included: true, value: 1 },
      { key: 'api_access', name: 'API access', included: false, value: false },
    ],
  },
  {
    id: 'plan_pro_monthly',
    name: 'Pro',
    description: 'Higher quotas, API access, and team collaboration.',
    interval: 'month',
    priceInCents: 2900,
    currency: 'usd',
    trialDays: 14,
    sortOrder: 1,
    features: [
      { key: 'projects', name: 'Projects', included: true, value: 25 },
      { key: 'storage', name: 'Storage (GB)', included: true, value: 100 },
      { key: 'api_access', name: 'API access', included: true, value: true },
      { key: 'team_members', name: 'Team members', included: true, value: true },
    ],
  },
  {
    id: 'plan_team_monthly',
    name: 'Team',
    description: 'Expanded seats, webhooks, and custom branding.',
    interval: 'month',
    priceInCents: 9900,
    currency: 'usd',
    trialDays: 14,
    sortOrder: 2,
    features: [
      { key: 'projects', name: 'Projects', included: true, value: 250 },
      { key: 'storage', name: 'Storage (GB)', included: true, value: 1000 },
      { key: 'api_access', name: 'API access', included: true, value: true },
      { key: 'team_members', name: 'Team members', included: true, value: true },
      { key: 'custom_branding', name: 'Custom branding', included: true, value: true },
    ],
  },
] as const;

const DEMO_ENABLED_FLAGS = [
  { key: 'flags.billing', description: 'Enable billing plans, subscriptions, and checkout.' },
  { key: 'orgs.teams', description: 'Enable organization switcher and team collaboration.' },
  { key: 'flags.advanced_admin', description: 'Enable extended platform admin console surfaces.' },
  { key: 'flags.activity_feed', description: 'Enable workspace and account activity streams.' },
  { key: 'flags.media', description: 'Enable media gallery and file uploads.' },
] as const;

const DEMO_STATUS_COMPONENTS = ['database', 'cache', 'queue', 'storage', 'email'] as const;

const DEMO_TASKS = [
  { title: 'Configure brand accent and logo in bslt.config.ts', completed: true },
  { title: 'Invite teammates to Acme Studio workspace', completed: false },
  { title: 'Verify webhook delivery in Workspace Webhooks', completed: false },
] as const;

async function tableExists(
  db: ReturnType<typeof createDbClient>,
  tableName: string,
): Promise<boolean> {
  if (typeof db.queryOne !== 'function') return false;
  const row = await db.queryOne<{ readonly exists: boolean }>({
    text: `SELECT to_regclass($1) IS NOT NULL AS exists`,
    values: [`public.${tableName}`],
  });
  return row?.exists === true;
}

async function seedDemoScenario(db: ReturnType<typeof createDbClient>): Promise<void> {
  console.log('\n🎭 Seeding rich SaaS demo scenario...');

  if (await tableExists(db, 'billing_plans')) {
    for (const plan of DEMO_BILLING_PLANS) {
      await db.execute({
        text: [
          'INSERT INTO billing_plans (id, name, description, interval, price_in_cents, currency, features, trial_days, is_active, sort_order)',
          'VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, true, $9)',
          'ON CONFLICT (id) DO UPDATE SET',
          '  name = EXCLUDED.name,',
          '  description = EXCLUDED.description,',
          '  price_in_cents = EXCLUDED.price_in_cents,',
          '  features = EXCLUDED.features,',
          '  trial_days = EXCLUDED.trial_days,',
          '  is_active = true,',
          '  sort_order = EXCLUDED.sort_order',
        ].join('\n'),
        values: [
          plan.id,
          plan.name,
          plan.description,
          plan.interval,
          plan.priceInCents,
          plan.currency,
          JSON.stringify(plan.features),
          plan.trialDays,
          plan.sortOrder,
        ],
      });
    }
    console.log(`  ✓ ${String(DEMO_BILLING_PLANS.length)} starter billing plans (Free, Pro, Team)`);
  }

  if (await tableExists(db, 'flags')) {
    for (const flag of DEMO_ENABLED_FLAGS) {
      await db.execute({
        text: [
          'INSERT INTO flags (key, description, is_enabled)',
          'VALUES ($1, $2, true)',
          'ON CONFLICT (key) DO UPDATE SET is_enabled = true',
        ].join('\n'),
        values: [flag.key, flag.description],
      });
    }
    console.log(`  ✓ ${String(DEMO_ENABLED_FLAGS.length)} demo runtime feature flags enabled`);
  }

  if (
    (await tableExists(db, 'orgs')) &&
    (await tableExists(db, 'orgs_members')) &&
    (await tableExists(db, 'orgs_invitations'))
  ) {
    await db.execute({
      text: [
        'WITH admin_user AS (SELECT id FROM identity_users WHERE email = $1 LIMIT 1),',
        'upserted_org AS (',
        '  INSERT INTO orgs (name, slug, owner_id, metadata)',
        '  SELECT $2, $3, id, $4::jsonb FROM admin_user',
        '  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name',
        '  RETURNING id',
        '),',
        'target_org AS (',
        '  SELECT id FROM upserted_org UNION ALL SELECT id FROM orgs WHERE slug = $3 LIMIT 1',
        ')',
        'INSERT INTO orgs_members (org_id, user_id, role, is_billing_admin)',
        'SELECT target_org.id, u.id,',
        "  CASE u.email WHEN 'admin@example.com' THEN 'owner'::orgs_role WHEN 'user@example.com' THEN 'admin'::orgs_role ELSE 'member'::orgs_role END,",
        "  u.email = 'admin@example.com'",
        'FROM target_org CROSS JOIN identity_users u',
        "WHERE u.email IN ('admin@example.com', 'user@example.com', 'demo@example.com')",
        'ON CONFLICT (org_id, user_id) DO NOTHING',
      ].join('\n'),
      values: ['admin@example.com', 'Acme Studio', 'acme-studio', JSON.stringify({ tier: 'demo' })],
    });

    await db.execute({
      text: [
        'INSERT INTO orgs_invitations (org_id, email, role, status, invited_by_id, expires_at)',
        "SELECT o.id, $1, 'member'::orgs_role, 'pending'::orgs_invitation_status, u.id, NOW() + INTERVAL '7 days'",
        'FROM orgs o JOIN identity_users u ON u.email = $2',
        'WHERE o.slug = $3',
        "  AND NOT EXISTS (SELECT 1 FROM orgs_invitations i WHERE i.org_id = o.id AND i.email = $1 AND i.status = 'pending')",
      ].join('\n'),
      values: ['invitee@acme.test', 'admin@example.com', 'acme-studio'],
    });
    console.log('  ✓ Demo workspace "Acme Studio" (owner, admin, member, pending invite)');
  }

  if (await tableExists(db, 'status_components')) {
    for (const component of DEMO_STATUS_COMPONENTS) {
      await db.execute({
        text: [
          "INSERT INTO status_components (component, state) VALUES ($1, 'up')",
          "ON CONFLICT (component) DO UPDATE SET state = 'up', checked_at = NOW()",
        ].join('\n'),
        values: [component],
      });
    }
    console.log(`  ✓ ${String(DEMO_STATUS_COMPONENTS.length)} operational status components`);
  }

  if (await tableExists(db, 'tasks')) {
    for (const task of DEMO_TASKS) {
      await db.execute({
        text: [
          'INSERT INTO tasks (owner_user_id, title, completed)',
          'SELECT u.id, $2, $3 FROM identity_users u',
          'WHERE u.email = $1',
          '  AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.owner_user_id = u.id AND t.title = $2)',
        ].join('\n'),
        values: ['admin@example.com', task.title, task.completed],
      });
    }
    console.log(`  ✓ ${String(DEMO_TASKS.length)} sample starter tasks`);
  }
}

export async function seed(
  options: { readonly closeConnection?: boolean; readonly demo?: boolean } = {},
): Promise<void> {
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

    if (options.demo === true) {
      await seedDemoScenario(db);
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
