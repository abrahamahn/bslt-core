// main/kernel/db/src/roles.ts
/**
 * Database Roles
 *
 * The role split that makes Row-Level Security enforceable. A superuser — or
 * the owner of a table — bypasses every policy, so no runtime connection may be
 * either:
 *
 * | Role            | Kind    | Purpose                                                    |
 * | --------------- | ------- | ---------------------------------------------------------- |
 * | `bslt_owner`    | LOGIN   | Owns every schema object; runs migrations (DDL). Never the |
 * |                 |         | runtime role.                                              |
 * | `bslt_app`      | LOGIN   | Runtime role for user sessions. NOSUPERUSER, NOBYPASSRLS,  |
 * |                 |         | DML only (through `authenticated`). Each session sets the  |
 * |                 |         | role `authenticated` for its transaction.                  |
 * | `bslt_worker`   | LOGIN   | Sessionless and background work (auth flows before a user  |
 * |                 |         | exists, webhooks, jobs, cron, retention). NOBYPASSRLS: it  |
 * |                 |         | holds only what `bslt_system` is granted, and reaches rows |
 * |                 |         | only through policies written `TO bslt_system`. It is not  |
 * |                 |         | a member of `authenticated`.                               |
 * | `authenticated` | NOLOGIN | Policy target for end-user sessions.                       |
 * | `bslt_system`   | NOLOGIN | Policy target for trusted system work.                     |
 * | `bslt_definer`  | NOLOGIN | Policy target for SECURITY DEFINER helpers. They run as    |
 * |                 |         | the owner, which FORCE ROW LEVEL SECURITY binds too; the   |
 * |                 |         | owner is a member, and reads through read-only policies    |
 * |                 |         | written `TO bslt_definer`.                                 |
 *
 * The NOLOGIN roles carry the table grants (set per table by the migrations);
 * login roles get them through membership. No default privileges exist for any
 * of them, so a table created later is unreachable until a migration classifies
 * it. Passwords are never sent to the server in clear: the bootstrap computes
 * the SCRAM-SHA-256 verifier locally, the way `psql \password` does, so they
 * cannot surface in `log_statement` output.
 *
 * @module roles
 */

import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

import { runLockedBootstrapStatements } from './migrate/roles';
import { buildPostgresDsn } from './utils/postgres-dsn';

import type { RawDb } from './client';

// ============================================================================
// Role names
// ============================================================================

/** Every role in the split. Fixed names: migrations and policies reference them. */
export const DB_ROLES = Object.freeze({
  owner: 'bslt_owner',
  app: 'bslt_app',
  worker: 'bslt_worker',
  authenticated: 'authenticated',
  system: 'bslt_system',
  definer: 'bslt_definer',
} as const);

/** Passwords of the three LOGIN roles. */
export interface DatabaseRolePasswords {
  readonly owner: string;
  readonly app: string;
  readonly worker: string;
}

// ============================================================================
// SCRAM verifier
// ============================================================================

/** Postgres' own default (`scram_iterations`). */
const SCRAM_ITERATIONS = 4096;

/**
 * Compute a Postgres SCRAM-SHA-256 password verifier (RFC 5802 / RFC 7677).
 *
 * `ALTER ROLE ... PASSWORD '<verifier>'` stores it as-is, so the plaintext never
 * reaches the server.
 *
 * @param password - Plaintext password (ASCII; see {@link bootstrapClusterRoles}).
 * @param salt - Random salt (16 fresh bytes by default).
 * @param iterations - PBKDF2 iterations; never below Postgres' default.
 * @returns `SCRAM-SHA-256$<iter>:<salt>$<StoredKey>:<ServerKey>`
 * @throws {Error} When `iterations` is below the Postgres default.
 */
export function scramSha256Verifier(
  password: string,
  salt: Buffer = randomBytes(16),
  iterations: number = SCRAM_ITERATIONS,
): string {
  if (!Number.isInteger(iterations) || iterations < SCRAM_ITERATIONS) {
    throw new Error(`SCRAM iterations must be an integer of at least ${String(SCRAM_ITERATIONS)}`);
  }
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest('base64');
  const serverKey = createHmac('sha256', salted).update('Server Key').digest('base64');
  return `SCRAM-SHA-256$${String(iterations)}:${salt.toString('base64')}$${storedKey}:${serverKey}`;
}

// ============================================================================
// Bootstrap
// ============================================================================

const MIN_PASSWORD_LENGTH = 16;
/** Printable ASCII only: Postgres applies SASLprep, which rewrites other input. */
const PASSWORD_PATTERN = /^[\x20-\x7E]+$/;
const BOOTSTRAP_LOCK_KEY = 'bslt:bootstrap-database-roles';

/** Common attributes: nothing that bypasses RLS, creates roles/databases or replicates. */
const SAFE_ATTRIBUTES = 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';

function assertPasswords(passwords: DatabaseRolePasswords): void {
  const entries: ReadonlyArray<readonly [string, string]> = [
    [DB_ROLES.owner, passwords.owner],
    [DB_ROLES.app, passwords.app],
    [DB_ROLES.worker, passwords.worker],
  ];
  for (const [role, password] of entries) {
    if (password.length < MIN_PASSWORD_LENGTH || !PASSWORD_PATTERN.test(password)) {
      // Never echo the rejected value.
      throw new Error(
        `Password for ${role} must be at least ${String(MIN_PASSWORD_LENGTH)} printable ASCII characters`,
      );
    }
  }
  if (new Set(entries.map(([, password]) => password)).size !== entries.length) {
    throw new Error('Passwords for the owner, app and worker roles must be distinct');
  }
}

/** `IF NOT EXISTS ... CREATE ROLE` for every role (role names are constants). */
function createMissingRolesSql(): string {
  const creates = Object.values(DB_ROLES)
    .map(
      (role) =>
        `  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role}; END IF;`,
    )
    .join('\n');
  return `DO $$\nBEGIN\n${creates}\nEND $$`;
}

/**
 * The only roles each runtime role and policy target may be a member of.
 * Membership is how a role leaves its policies: `SET ROLE` to a superuser, a
 * BYPASSRLS role or the table owner, or simply inheriting the owner's rights.
 * An allowlist, so a grant nobody anticipated is revoked too.
 *
 * The worker is not a member of `authenticated`: no code gives the system pool
 * a user id, and holding the end-user grants as well would make the
 * `bslt_system` grant lists meaningless as a ceiling.
 */
const ALLOWED_MEMBERSHIPS: ReadonlyArray<readonly [member: string, roles: readonly string[]]> = [
  [DB_ROLES.app, [DB_ROLES.authenticated]],
  [DB_ROLES.worker, [DB_ROLES.system]],
  [DB_ROLES.authenticated, []],
  [DB_ROLES.system, []],
  [DB_ROLES.definer, []],
];

/**
 * Revoke every membership outside {@link ALLOWED_MEMBERSHIPS}, whoever granted
 * it, so drift introduced by hand is repaired on the next run.
 */
const REVOKE_UNEXPECTED_MEMBERSHIPS_SQL = `DO $$
DECLARE
  grant_row record;
BEGIN
  FOR grant_row IN
    SELECT pg_get_userbyid(m.roleid) AS granted,
           pg_get_userbyid(m.member) AS member,
           pg_get_userbyid(m.grantor) AS grantor
      FROM pg_auth_members m
      JOIN (VALUES ${ALLOWED_MEMBERSHIPS.map(
        ([member, roles]) =>
          `('${member}', ARRAY[${roles.map((role) => `'${role}'`).join(', ')}]::text[])`,
      ).join(',\n                   ')}) AS allowed(member, roles)
        ON m.member = allowed.member::regrole
     WHERE pg_get_userbyid(m.roleid) <> ALL (allowed.roles)
  LOOP
    EXECUTE format('REVOKE %I FROM %I GRANTED BY %I', grant_row.granted, grant_row.member, grant_row.grantor);
  END LOOP;
END $$`;

/** Cluster-level statements (roles are shared by every database in the cluster). */
function clusterStatements(passwords: DatabaseRolePasswords): string[] {
  const login = (role: string, password: string): string =>
    `ALTER ROLE ${role} WITH LOGIN ${SAFE_ATTRIBUTES} INHERIT PASSWORD '${scramSha256Verifier(password)}'`;

  return [
    createMissingRolesSql(),
    `ALTER ROLE ${DB_ROLES.authenticated} WITH NOLOGIN ${SAFE_ATTRIBUTES}`,
    `ALTER ROLE ${DB_ROLES.system} WITH NOLOGIN ${SAFE_ATTRIBUTES}`,
    `ALTER ROLE ${DB_ROLES.definer} WITH NOLOGIN ${SAFE_ATTRIBUTES}`,
    login(DB_ROLES.owner, passwords.owner),
    login(DB_ROLES.app, passwords.app),
    login(DB_ROLES.worker, passwords.worker),
    REVOKE_UNEXPECTED_MEMBERSHIPS_SQL,
    // The app role acts for users (role `authenticated` per transaction); the worker
    // reaches rows through policies written TO bslt_system; the owner's
    // SECURITY DEFINER helpers read through policies written TO bslt_definer.
    // Guarded so a re-run does not emit "already a member" notices.
    `DO $$
BEGIN
  IF NOT pg_has_role('${DB_ROLES.app}', '${DB_ROLES.authenticated}', 'USAGE') THEN
    GRANT ${DB_ROLES.authenticated} TO ${DB_ROLES.app};
  END IF;
  IF NOT pg_has_role('${DB_ROLES.worker}', '${DB_ROLES.system}', 'USAGE') THEN
    GRANT ${DB_ROLES.system} TO ${DB_ROLES.worker};
  END IF;
  IF NOT pg_has_role('${DB_ROLES.owner}', '${DB_ROLES.definer}', 'USAGE') THEN
    GRANT ${DB_ROLES.definer} TO ${DB_ROLES.owner};
  END IF;
END $$`,
  ];
}

/**
 * Hand the connected database to the owner role: the database itself, the
 * public schema, and every table, view, sequence, type and routine in it that
 * an earlier (superuser) migrator created. Extension members and column-owned
 * sequences are skipped — they follow their extension / table.
 */
const ADOPT_OWNERSHIP_SQL = `DO $$
DECLARE
  obj record;
  owner_oid oid := '${DB_ROLES.owner}'::regrole;
BEGIN
  EXECUTE format('ALTER DATABASE %I OWNER TO ${DB_ROLES.owner}', current_database());

  FOR obj IN
    SELECT c.oid::regclass::text AS ident,
           CASE c.relkind
             WHEN 'S' THEN 'SEQUENCE'
             WHEN 'v' THEN 'VIEW'
             WHEN 'm' THEN 'MATERIALIZED VIEW'
             WHEN 'f' THEN 'FOREIGN TABLE'
             ELSE 'TABLE'
           END AS kind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
       AND c.relowner <> owner_oid
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
            AND (d.deptype = 'e' OR (c.relkind = 'S' AND d.deptype IN ('a', 'i'))))
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO ${DB_ROLES.owner}', obj.kind, obj.ident);
  END LOOP;

  FOR obj IN
    SELECT t.oid::regtype::text AS ident
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public'
       AND t.typowner <> owner_oid
       AND (t.typtype IN ('e', 'd', 'r')
            OR (t.typtype = 'c'
                AND EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind = 'c')))
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER TYPE %s OWNER TO ${DB_ROLES.owner}', obj.ident);
  END LOOP;

  FOR obj IN
    SELECT p.oid::regprocedure::text AS ident
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind IN ('f', 'p')
       AND p.proowner <> owner_oid
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO ${DB_ROLES.owner}', obj.ident);
  END LOOP;
END $$`;

/**
 * Remove every default privilege that names a runtime role or policy target,
 * whichever role the entry belongs to (the owner, or a superuser that ran
 * an earlier setup, before the split) and whatever it covers (tables, sequences,
 * schemas). Earlier versions granted blanket DML this way, which made every
 * table created later reachable before anyone decided who may reach it.
 */
const REVOKE_DEFAULT_PRIVILEGES_SQL = `DO $$
DECLARE
  entry record;
BEGIN
  FOR entry IN
    SELECT DISTINCT
           pg_get_userbyid(d.defaclrole) AS creator,
           CASE WHEN d.defaclnamespace = 0 THEN ''
                ELSE 'IN SCHEMA ' || d.defaclnamespace::regnamespace::text END AS scope,
           CASE d.defaclobjtype
             WHEN 'r' THEN 'TABLES'
             WHEN 'S' THEN 'SEQUENCES'
             WHEN 'f' THEN 'FUNCTIONS'
             WHEN 'T' THEN 'TYPES'
             WHEN 'n' THEN 'SCHEMAS'
           END AS kind,
           g.rolname AS grantee
      FROM pg_default_acl d
     CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
      JOIN pg_roles g ON g.oid = acl.grantee
     WHERE g.rolname IN (${Object.values(DB_ROLES)
       .filter((role) => role !== DB_ROLES.owner)
       .map((role) => `'${role}'`)
       .join(', ')})
  LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I %s REVOKE ALL ON %s FROM %I',
                   entry.creator, entry.scope, entry.kind, entry.grantee);
  END LOOP;
END $$`;

/** Database-level statements for the database the admin is connected to. */
function databaseStatements(): string[] {
  return [
    ADOPT_OWNERSHIP_SQL,
    `GRANT USAGE, CREATE ON SCHEMA public TO ${DB_ROLES.owner}`,
    REVOKE_DEFAULT_PRIVILEGES_SQL,
  ];
}

async function runLocked(admin: RawDb, statements: readonly string[]): Promise<void> {
  // Serialise concurrent bootstraps (CREATE ROLE races on pg_authid).
  await runLockedBootstrapStatements(admin, BOOTSTRAP_LOCK_KEY, statements);
}

/**
 * Create or repair the cluster-wide roles, idempotently.
 *
 * Re-asserts every attribute and membership on each run, so a role that drifted
 * (someone granted `BYPASSRLS`, or `bslt_system` to the app role) is repaired.
 * Touches no database objects. Requires a superuser admin connection.
 *
 * @param admin - Superuser connection (any database in the cluster).
 * @param passwords - Passwords for the owner, app and worker LOGIN roles.
 * @throws {Error} On a weak, non-ASCII or reused password — before connecting.
 */
export async function bootstrapClusterRoles(
  admin: RawDb,
  passwords: DatabaseRolePasswords,
): Promise<void> {
  assertPasswords(passwords);
  await runLocked(admin, clusterStatements(passwords));
}

/**
 * Cluster roles plus ownership of the connected database, in one transaction.
 *
 * This is what `pnpm db:bootstrap:roles` runs against an existing deployment:
 * afterwards migrations can run as `bslt_owner`, even on a database a superuser
 * migrated before.
 *
 * @param admin - Superuser connection to the application database.
 * @param passwords - Passwords for the owner, app and worker LOGIN roles.
 * @throws {Error} On a weak, non-ASCII or reused password — before connecting.
 */
export async function bootstrapDatabaseRoles(
  admin: RawDb,
  passwords: DatabaseRolePasswords,
): Promise<void> {
  assertPasswords(passwords);
  await runLocked(admin, [...clusterStatements(passwords), ...databaseStatements()]);
}

// ============================================================================
// Bootstrap configuration from env
// ============================================================================

/** Where the bootstrap connects, and the passwords it provisions. */
export interface RoleBootstrapEnv {
  readonly adminConnectionString: string;
  readonly passwords: DatabaseRolePasswords;
}

type Env = Readonly<Record<string, string | undefined>>;

function passwordFromUrl(env: Env, key: string, role: string): string {
  const raw = env[key];
  if (raw === undefined || raw === '') {
    throw new Error(`${key} is required to bootstrap database roles (it must connect as ${role})`);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${key} is not a valid connection URL`);
  }
  if (decodeURIComponent(url.username) !== role) {
    throw new Error(`${key} must connect as ${role}`);
  }
  if (url.password === '') {
    throw new Error(`${key} must carry a password for ${role}`);
  }
  return decodeURIComponent(url.password);
}

/**
 * Resolve the bootstrap's admin connection and role passwords from env.
 *
 * Each role's password is read from the URL that role logs in with, so there is
 * one source of truth per secret: `MIGRATION_DATABASE_URL` (owner),
 * `DATABASE_URL` (app), `WORKER_DATABASE_URL` (worker). The admin connection is
 * `DATABASE_ADMIN_URL`, else the `POSTGRES_*` parts (the container superuser) —
 * never `DATABASE_URL`, which is the unprivileged app role.
 *
 * @param env - Environment variables.
 * @returns Admin connection string and role passwords.
 * @throws {Error} When a URL is missing, malformed, names the wrong role or has
 *   no password. Messages never include the URL or password.
 */
export function resolveRoleBootstrapEnv(env: Env): RoleBootstrapEnv {
  const passwords: DatabaseRolePasswords = {
    owner: passwordFromUrl(env, 'MIGRATION_DATABASE_URL', DB_ROLES.owner),
    app: passwordFromUrl(env, 'DATABASE_URL', DB_ROLES.app),
    worker: passwordFromUrl(env, 'WORKER_DATABASE_URL', DB_ROLES.worker),
  };

  const explicitAdmin = env['DATABASE_ADMIN_URL'];
  const adminConnectionString =
    explicitAdmin !== undefined && explicitAdmin !== ''
      ? explicitAdmin
      : buildPostgresDsn({
          user: env['POSTGRES_USER'] ?? env['DB_USER'] ?? 'postgres',
          password: env['POSTGRES_PASSWORD'] ?? env['DB_PASSWORD'] ?? '',
          host: env['POSTGRES_HOST'] ?? env['DB_HOST'] ?? 'localhost',
          port: env['POSTGRES_PORT'] ?? env['DB_PORT'] ?? '5432',
          database: env['POSTGRES_DB'] ?? env['DB_NAME'] ?? 'app_dev',
        });

  return { adminConnectionString, passwords };
}

// ============================================================================
// Runtime verification
// ============================================================================

/** What the connected role can do, as far as RLS is concerned. */
export interface DatabaseRoleFacts {
  readonly name: string;
  readonly superuser: boolean;
  readonly bypassRls: boolean;
  /**
   * Owns a table in `public`, directly or through membership in its owner
   * (owners, and roles that inherit from them, bypass non-forced RLS).
   */
  readonly ownsTables: boolean;
  /** Is a member of `bslt_system` (policies granting cross-user access apply). */
  readonly actsAsSystem: boolean;
  /** Is a member of a superuser or BYPASSRLS role, so `SET ROLE` leaves every policy. */
  readonly escalates: boolean;
}

interface RoleFactsRow {
  name: string;
  superuser: boolean;
  bypass_rls: boolean;
  owns_tables: boolean;
  acts_as_system: boolean;
  escalates: boolean;
}

/**
 * Inspect the role a connection logs in as.
 *
 * @param db - Unscoped client (no session: it reports the login role).
 * @returns The role's RLS-relevant facts.
 * @throws {Error} When the catalog returns no row for the current role.
 */
export async function inspectDatabaseRole(db: RawDb): Promise<DatabaseRoleFacts> {
  const row = await db.queryOne<RoleFactsRow>({
    text: `SELECT r.rolname AS name,
                  r.rolsuper AS superuser,
                  r.rolbypassrls AS bypass_rls,
                  EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                             AND pg_has_role(r.oid, c.relowner, 'MEMBER')) AS owns_tables,
                  EXISTS (SELECT 1 FROM pg_roles s
                           WHERE s.rolname = $1 AND pg_has_role(r.oid, s.oid, 'MEMBER')) AS acts_as_system,
                  EXISTS (SELECT 1 FROM pg_roles p
                           WHERE (p.rolsuper OR p.rolbypassrls) AND p.oid <> r.oid
                             AND pg_has_role(r.oid, p.oid, 'MEMBER')) AS escalates
             FROM pg_roles r
            WHERE r.rolname = current_user`,
    values: [DB_ROLES.system],
  });
  if (row === null) {
    throw new Error('Could not inspect the current role in pg_roles');
  }
  return {
    name: row.name,
    superuser: row.superuser,
    bypassRls: row.bypass_rls,
    ownsTables: row.owns_tables,
    actsAsSystem: row.acts_as_system,
    escalates: row.escalates,
  };
}

/**
 * List every way the runtime connections defeat RLS. Empty means safe.
 *
 * @param app - Facts for the `DATABASE_URL` (user-session) role.
 * @param worker - Facts for the `WORKER_DATABASE_URL` (system) role.
 * @returns Human-readable problems naming the env key to fix.
 */
export function findRuntimeRoleProblems(
  app: DatabaseRoleFacts,
  worker: DatabaseRoleFacts,
): string[] {
  const problems: string[] = [];
  const fix = `run pnpm db:bootstrap:roles and connect as ${DB_ROLES.app} / ${DB_ROLES.worker}`;

  if (app.superuser) {
    problems.push(`DATABASE_URL connects as superuser "${app.name}": every RLS policy is bypassed`);
  }
  if (app.bypassRls) {
    problems.push(`DATABASE_URL role "${app.name}" has BYPASSRLS: RLS policies never apply to it`);
  }
  if (app.ownsTables) {
    problems.push(
      `DATABASE_URL role "${app.name}" owns tables in public: owners bypass RLS; run migrations as ${DB_ROLES.owner}`,
    );
  }
  if (app.actsAsSystem) {
    problems.push(
      `DATABASE_URL role "${app.name}" is a member of ${DB_ROLES.system}: it can reach every user's rows`,
    );
  }
  if (app.escalates) {
    problems.push(
      `DATABASE_URL role "${app.name}" is a member of a superuser or BYPASSRLS role: it can SET ROLE out of every RLS policy`,
    );
  }
  if (worker.superuser) {
    problems.push(
      `WORKER_DATABASE_URL connects as superuser "${worker.name}": background work must not hold superuser rights`,
    );
  }
  if (worker.bypassRls) {
    problems.push(
      `WORKER_DATABASE_URL role "${worker.name}" has BYPASSRLS: system access must come from explicit ${DB_ROLES.system} policies`,
    );
  }
  if (worker.escalates) {
    problems.push(
      `WORKER_DATABASE_URL role "${worker.name}" is a member of a superuser or BYPASSRLS role: it can SET ROLE to rights background work must not hold`,
    );
  }
  if (worker.ownsTables) {
    problems.push(
      `WORKER_DATABASE_URL role "${worker.name}" owns tables in public: background work must not hold DDL rights`,
    );
  }
  if (!worker.actsAsSystem) {
    problems.push(
      `WORKER_DATABASE_URL role "${worker.name}" is not a member of ${DB_ROLES.system}: sessionless and background work cannot reach rows behind RLS`,
    );
  }
  if (app.name === worker.name) {
    problems.push(
      `DATABASE_URL and WORKER_DATABASE_URL connect as the same role "${app.name}": ${fix}`,
    );
  }
  return problems;
}
