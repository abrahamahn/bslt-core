// main/kernel/server/src/testing/database/provisioning.ts
/**
 * Real-DB harness provisioning: which connection is the cluster admin, and
 * which passwords the role split gets. Pure, so every env combination is unit
 * tested without a database (see the colocated test).
 */

import { hkdfSync } from 'node:crypto';

import { DB_ROLES, resolveRoleBootstrapEnv, type DatabaseRolePasswords } from '@bslt/db';

/** Environment variables as the harness reads them (`process.env` shape). */
export type HarnessEnv = Readonly<Record<string, string | undefined>>;

/** Where the admin connection came from. Used in messages instead of the URL. */
export type HarnessAdminSource =
  'DATABASE_ADMIN_URL' | 'POSTGRES_*' | 'the base connection (DATABASE_URL, else POSTGRES_*)';

/** The superuser connection the harness provisions with, and the role passwords. */
export interface HarnessProvisioning {
  readonly adminConnectionString: string;
  readonly adminSource: HarnessAdminSource;
  readonly passwords: DatabaseRolePasswords;
}

const ROLE_URL_KEYS = ['MIGRATION_DATABASE_URL', 'WORKER_DATABASE_URL'] as const;
const SPLIT_LOGIN_ROLES: readonly string[] = [DB_ROLES.owner, DB_ROLES.app, DB_ROLES.worker];
const ADMIN_PART_KEYS = ['POSTGRES_USER', 'DB_USER', 'POSTGRES_HOST', 'DB_HOST'] as const;

function isSet(env: HarnessEnv, key: string): boolean {
  return (env[key] ?? '') !== '';
}

/** The login role a connection URL names, or `undefined` when it is not a URL. */
function loginRoleOf(connectionString: string): string | undefined {
  try {
    return decodeURIComponent(new URL(connectionString).username);
  } catch {
    return undefined;
  }
}

/**
 * Resolve the admin connection and role passwords for the test cluster.
 */
export function resolveHarnessProvisioning(
  env: HarnessEnv,
  baseConnectionString: string,
): HarnessProvisioning {
  const explicitAdmin = isSet(env, 'DATABASE_ADMIN_URL') ? env['DATABASE_ADMIN_URL'] : undefined;
  const baseRole = loginRoleOf(baseConnectionString);
  const splitConfigured =
    ROLE_URL_KEYS.some((key) => isSet(env, key)) ||
    (baseRole !== undefined && SPLIT_LOGIN_ROLES.includes(baseRole));

  if (splitConfigured) {
    const { adminConnectionString, passwords } = resolveRoleBootstrapEnv(env);
    if (explicitAdmin !== undefined) {
      return { adminConnectionString, adminSource: 'DATABASE_ADMIN_URL', passwords };
    }
    if (!ADMIN_PART_KEYS.some((key) => isSet(env, key))) {
      throw new Error(
        'The role split is configured (DATABASE_URL connects as bslt_app) but no superuser ' +
          'connection is: set DATABASE_ADMIN_URL, or POSTGRES_HOST / POSTGRES_PORT / ' +
          'POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB, so the real-DB harness can create ' +
          'roles and databases',
      );
    }
    return { adminConnectionString, adminSource: 'POSTGRES_*', passwords };
  }

  const adminConnectionString = explicitAdmin ?? baseConnectionString;
  const derive = (role: string): string =>
    Buffer.from(
      hkdfSync(
        'sha256',
        adminConnectionString,
        'bslt-test-harness',
        `role-password/v1/${role}`,
        24,
      ),
    ).toString('base64url');

  return {
    adminConnectionString,
    adminSource:
      explicitAdmin !== undefined
        ? 'DATABASE_ADMIN_URL'
        : 'the base connection (DATABASE_URL, else POSTGRES_*)',
    passwords: {
      owner: derive(DB_ROLES.owner),
      app: derive(DB_ROLES.app),
      worker: derive(DB_ROLES.worker),
    },
  };
}

/**
 * Say why a role cannot be the harness admin, or `null` when it can.
 */
export function describeHarnessAdminProblem(
  role: { readonly name: string; readonly superuser: boolean },
  source: HarnessAdminSource,
): string | null {
  if (role.superuser) return null;
  return (
    `The real-DB harness admin connection (from ${source}) logs in as "${role.name}", ` +
    'which is not a superuser: it cannot create roles or databases. Point DATABASE_ADMIN_URL ' +
    '(or the POSTGRES_* parts) at a superuser'
  );
}
