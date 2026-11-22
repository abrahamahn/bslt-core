// main/kernel/db/src/roles.test.ts
import { createHash, createHmac, pbkdf2Sync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  bootstrapClusterRoles,
  bootstrapDatabaseRoles,
  DB_ROLES,
  findRuntimeRoleProblems,
  inspectDatabaseRole,
  resolveRoleBootstrapEnv,
  scramSha256Verifier,
  type DatabaseRoleFacts,
  type DatabaseRolePasswords,
} from './roles';

import type { RawDb } from './client';

const PASSWORDS: DatabaseRolePasswords = {
  owner: 'owner-password-0123456789',
  app: 'app-password-0123456789ab',
  worker: 'worker-password-0123456789',
};

interface RecordedCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

/** A RawDb whose transaction records every statement it is handed. */
function recordingDb(): { db: RawDb; calls: RecordedCall[]; transactions: number } {
  const calls: RecordedCall[] = [];
  const state = { transactions: 0 };
  const tx = {
    raw: vi.fn(async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      return [];
    }),
  };
  const db = {
    transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => {
      state.transactions += 1;
      return cb(tx);
    }),
    raw: vi.fn(async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      return [];
    }),
  } as unknown as RawDb;
  return {
    db,
    calls,
    get transactions() {
      return state.transactions;
    },
  };
}

function facts(overrides: Partial<DatabaseRoleFacts>): DatabaseRoleFacts {
  return {
    name: 'x',
    superuser: false,
    bypassRls: false,
    ownsTables: false,
    actsAsSystem: false,
    escalates: false,
    ...overrides,
  };
}

describe('DB_ROLES', () => {
  it('separates the owner, runtime and policy-target roles', () => {
    expect(DB_ROLES).toEqual({
      owner: 'bslt_owner',
      app: 'bslt_app',
      worker: 'bslt_worker',
      authenticated: 'authenticated',
      system: 'bslt_system',
      definer: 'bslt_definer',
    });
    expect(new Set(Object.values(DB_ROLES)).size).toBe(6);
  });
});

describe('scramSha256Verifier', () => {
  const salt = Buffer.from('0123456789abcdef');

  it('produces a Postgres SCRAM-SHA-256 verifier (RFC 5802 StoredKey/ServerKey)', () => {
    const verifier = scramSha256Verifier('pencil', salt, 4096);

    // Independent derivation of the same values, straight from RFC 5802.
    const salted = pbkdf2Sync('pencil', salt, 4096, 32, 'sha256');
    const clientKey = createHmac('sha256', salted).update('Client Key').digest();
    const storedKey = createHash('sha256').update(clientKey).digest('base64');
    const serverKey = createHmac('sha256', salted).update('Server Key').digest('base64');

    expect(verifier).toBe(
      `SCRAM-SHA-256$4096:${salt.toString('base64')}$${storedKey}:${serverKey}`,
    );
  });

  it('never embeds the plaintext password', () => {
    const verifier = scramSha256Verifier('plaintext-must-not-leak', salt);
    expect(verifier).not.toContain('plaintext-must-not-leak');
  });

  it('uses a fresh random salt per call by default', () => {
    expect(scramSha256Verifier('same-password-0123')).not.toBe(
      scramSha256Verifier('same-password-0123'),
    );
  });

  it('rejects an iteration count below the Postgres default', () => {
    expect(() => scramSha256Verifier('pencil', salt, 1)).toThrow(/iterations/);
  });
});

describe('bootstrapDatabaseRoles', () => {
  it('provisions everything inside one advisory-locked transaction', async () => {
    const rec = recordingDb();
    await bootstrapDatabaseRoles(rec.db, PASSWORDS);

    expect(rec.transactions).toBe(1);
    expect(rec.calls[0]?.text).toMatch(/pg_advisory_xact_lock/);
  });

  it('never sends a plaintext password to the server, in SQL text or bind values', async () => {
    const rec = recordingDb();
    await bootstrapDatabaseRoles(rec.db, PASSWORDS);

    const wire = JSON.stringify(rec.calls);
    for (const password of Object.values(PASSWORDS)) {
      expect(wire).not.toContain(password);
    }
    expect(wire).toContain('SCRAM-SHA-256$');
  });

  it('asserts the attributes that make RLS apply to the runtime roles', async () => {
    const rec = recordingDb();
    await bootstrapDatabaseRoles(rec.db, PASSWORDS);
    const sql = rec.calls.map((c) => c.text).join('\n');

    expect(sql).toMatch(
      /ALTER ROLE bslt_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/,
    );
    // The worker reaches cross-user rows through explicit bslt_system policies,
    // never through BYPASSRLS.
    expect(sql).toMatch(
      /ALTER ROLE bslt_worker WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/,
    );
    expect(sql).toMatch(/ALTER ROLE bslt_owner WITH LOGIN NOSUPERUSER/);
    expect(sql).not.toMatch(/(?<!NO)BYPASSRLS/);
    expect(sql).toMatch(/GRANT authenticated TO bslt_app/);
    expect(sql).toMatch(/GRANT bslt_system TO bslt_worker/);
  });

  it('keeps the worker out of `authenticated`: bslt_system is its whole ceiling', async () => {
    const rec = recordingDb();
    await bootstrapDatabaseRoles(rec.db, PASSWORDS);
    const sql = rec.calls.map((c) => c.text).join('\n');

    // No code gives the system pool a user id, so the worker never needs the
    // end-user grants; holding them would make every bslt_system grant list a lie.
    expect(sql).not.toMatch(/GRANT authenticated TO bslt_worker/);
    expect(sql).toContain("('bslt_worker', ARRAY['bslt_system']::text[])");
  });

  it('provisions bslt_definer as a NOLOGIN policy target the owner is a member of', async () => {
    const rec = recordingDb();
    await bootstrapDatabaseRoles(rec.db, PASSWORDS);
    const sql = rec.calls.map((c) => c.text).join('\n');

    // SECURITY DEFINER helpers run as the owner; under FORCE ROW LEVEL SECURITY
    // the owner reads only through policies written TO bslt_definer.
    expect(sql).toContain(
      "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bslt_definer') THEN CREATE ROLE bslt_definer;",
    );
    expect(sql).toMatch(
      /ALTER ROLE bslt_definer WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/,
    );
    expect(sql).toMatch(/GRANT bslt_definer TO bslt_owner/);
    // A policy target is never a member of anything, and no runtime role is a member of it.
    expect(sql).toContain("('bslt_definer', ARRAY[]::text[])");
    expect(sql).not.toMatch(/GRANT bslt_definer TO bslt_(app|worker)/);
  });

  it('revokes every membership outside each runtime role allowlist (drift repair)', async () => {
    const rec = recordingDb();
    await bootstrapDatabaseRoles(rec.db, PASSWORDS);
    const sql = rec.calls.map((c) => c.text).join('\n');

    // Any other grant — bslt_system, bslt_owner, a superuser or BYPASSRLS role —
    // would let a runtime role leave its policies through SET ROLE.
    expect(sql).toMatch(/REVOKE %I FROM %I GRANTED BY %I/);
    expect(sql).toContain("('bslt_app', ARRAY['authenticated']::text[])");
    expect(sql).toContain("('bslt_worker', ARRAY['bslt_system']::text[])");
    expect(sql).toContain("('authenticated', ARRAY[]::text[])");
    expect(sql).toContain("('bslt_system', ARRAY[]::text[])");
    // Revocation runs before the allowed memberships are (re)granted.
    expect(sql.indexOf('REVOKE %I')).toBeLessThan(sql.indexOf('GRANT authenticated TO bslt_app'));
  });

  it.each([
    ['empty', ''],
    ['short', 'short-pass'],
    ['non-ASCII (SASLprep would rewrite it)', 'pässwörd-0123456789'],
    ['control characters', 'password-0123456789\n'],
  ])('refuses a %s password before touching the database', async (_label, bad) => {
    const rec = recordingDb();
    await expect(bootstrapDatabaseRoles(rec.db, { ...PASSWORDS, app: bad })).rejects.toThrow(
      /bslt_app/,
    );
    expect(rec.transactions).toBe(0);
    expect(rec.calls).toHaveLength(0);
  });

  it('refuses to give two login roles the same password', async () => {
    const rec = recordingDb();
    await expect(
      bootstrapDatabaseRoles(rec.db, { ...PASSWORDS, worker: PASSWORDS.app }),
    ).rejects.toThrow(/distinct/);
    expect(rec.calls).toHaveLength(0);
  });

  it('hands the connected database and its objects to the owner role', async () => {
    const rec = recordingDb();
    await bootstrapDatabaseRoles(rec.db, PASSWORDS);
    const sql = rec.calls.map((c) => c.text).join('\n');

    expect(sql).toMatch(/ALTER DATABASE %I OWNER TO bslt_owner/);
    expect(sql).toMatch(/ALTER %s %s OWNER TO bslt_owner/);
  });

  it('grants no default privileges and revokes the ones an earlier version set', async () => {
    const rec = recordingDb();
    await bootstrapDatabaseRoles(rec.db, PASSWORDS);
    const sql = rec.calls.map((c) => c.text).join('\n');

    // A table created later is born with no runtime grants (default deny).
    expect(sql).not.toMatch(/DEFAULT PRIVILEGES[^;]*\bGRANT\b/);
    // Whoever created the entry (the owner, or a superuser that migrated before
    // the split), for tables, sequences and schemas alike.
    expect(sql).toMatch(/FROM pg_default_acl/);
    expect(sql).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE %I %s REVOKE ALL ON %s FROM %I/);
    for (const role of [
      'authenticated',
      'bslt_system',
      'bslt_definer',
      'bslt_app',
      'bslt_worker',
    ]) {
      expect(sql).toMatch(new RegExp(`rolname IN \\([^)]*'${role}'`));
    }
  });

  it('cluster-only bootstrap leaves every database untouched', async () => {
    const rec = recordingDb();
    await bootstrapClusterRoles(rec.db, PASSWORDS);
    const sql = rec.calls.map((c) => c.text).join('\n');

    expect(sql).toMatch(/ALTER ROLE bslt_app/);
    expect(sql).not.toMatch(/ALTER DATABASE|OWNER TO|DEFAULT PRIVILEGES/);
  });

  it('cluster-only bootstrap validates passwords first, too', async () => {
    const rec = recordingDb();
    await expect(bootstrapClusterRoles(rec.db, { ...PASSWORDS, owner: '' })).rejects.toThrow(
      /bslt_owner/,
    );
    expect(rec.transactions).toBe(0);
  });

  it('does not echo a rejected password in the error', async () => {
    const rec = recordingDb();
    const error = await bootstrapDatabaseRoles(rec.db, {
      ...PASSWORDS,
      owner: 'tiny-secret',
    }).catch((e: unknown) => e);
    expect(String(error)).not.toContain('tiny-secret');
  });
});

describe('resolveRoleBootstrapEnv', () => {
  const env = {
    POSTGRES_HOST: 'db.internal',
    POSTGRES_PORT: '5432',
    POSTGRES_DB: 'app',
    POSTGRES_USER: 'postgres',
    POSTGRES_PASSWORD: 'admin/secret',
    DATABASE_URL: `postgresql://bslt_app:${encodeURIComponent(PASSWORDS.app)}@db.internal:5432/app`,
    WORKER_DATABASE_URL: `postgresql://bslt_worker:${PASSWORDS.worker}@db.internal:5432/app`,
    MIGRATION_DATABASE_URL: `postgresql://bslt_owner:${PASSWORDS.owner}@db.internal:5432/app`,
  };

  it('reads each role password from its own connection URL', () => {
    const resolved = resolveRoleBootstrapEnv(env);
    expect(resolved.passwords).toEqual(PASSWORDS);
  });

  it('connects as the admin from POSTGRES_* parts, never through the app DATABASE_URL', () => {
    const resolved = resolveRoleBootstrapEnv(env);
    expect(resolved.adminConnectionString).toBe(
      'postgres://postgres:admin%2Fsecret@db.internal:5432/app',
    );
  });

  it('prefers an explicit DATABASE_ADMIN_URL', () => {
    const resolved = resolveRoleBootstrapEnv({
      ...env,
      DATABASE_ADMIN_URL: 'postgresql://admin:pw@other:5432/app',
    });
    expect(resolved.adminConnectionString).toBe('postgresql://admin:pw@other:5432/app');
  });

  it('refuses a URL that names the wrong role, without echoing its password', () => {
    let message = '';
    try {
      resolveRoleBootstrapEnv({
        ...env,
        WORKER_DATABASE_URL: `postgresql://postgres:${PASSWORDS.worker}@db.internal:5432/app`,
      });
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/WORKER_DATABASE_URL must connect as bslt_worker/);
    expect(message).not.toContain(PASSWORDS.worker);
  });

  it.each(['DATABASE_URL', 'WORKER_DATABASE_URL', 'MIGRATION_DATABASE_URL'])(
    'refuses when %s is missing',
    (key) => {
      expect(() => resolveRoleBootstrapEnv({ ...env, [key]: '' })).toThrow(new RegExp(key));
    },
  );

  it('refuses a URL without a password', () => {
    expect(() =>
      resolveRoleBootstrapEnv({
        ...env,
        DATABASE_URL: 'postgresql://bslt_app@db.internal:5432/app',
      }),
    ).toThrow(/DATABASE_URL must carry a password/);
  });

  it('refuses an unparseable URL', () => {
    expect(() => resolveRoleBootstrapEnv({ ...env, MIGRATION_DATABASE_URL: 'not a url' })).toThrow(
      /MIGRATION_DATABASE_URL/,
    );
  });
});

describe('inspectDatabaseRole', () => {
  it('maps the catalog row onto role facts', async () => {
    const db = {
      queryOne: vi.fn().mockResolvedValue({
        name: 'bslt_app',
        superuser: false,
        bypass_rls: false,
        owns_tables: false,
        acts_as_system: false,
        escalates: true,
      }),
    } as unknown as RawDb;

    await expect(inspectDatabaseRole(db)).resolves.toEqual({
      name: 'bslt_app',
      superuser: false,
      bypassRls: false,
      ownsTables: false,
      actsAsSystem: false,
      escalates: true,
    });
  });

  it('fails loudly when the catalog returns nothing', async () => {
    const db = { queryOne: vi.fn().mockResolvedValue(null) } as unknown as RawDb;
    await expect(inspectDatabaseRole(db)).rejects.toThrow(/current role/);
  });
});

describe('findRuntimeRoleProblems', () => {
  const app = facts({ name: 'bslt_app' });
  const worker = facts({ name: 'bslt_worker', actsAsSystem: true });

  it('accepts the bootstrapped role split', () => {
    expect(findRuntimeRoleProblems(app, worker)).toEqual([]);
  });

  it.each<[string, Partial<DatabaseRoleFacts>, RegExp]>([
    ['a superuser', { superuser: true }, /superuser/],
    ['BYPASSRLS', { bypassRls: true }, /BYPASSRLS/],
    ['a table owner', { ownsTables: true }, /owns tables/],
    ['a system-policy member', { actsAsSystem: true }, /bslt_system/],
    ['able to SET ROLE to a superuser or BYPASSRLS role', { escalates: true }, /SET ROLE/],
  ])('rejects an app role that is %s', (_label, override, pattern) => {
    const problems = findRuntimeRoleProblems({ ...app, ...override }, worker);
    expect(problems.some((p) => pattern.test(p) && p.includes('DATABASE_URL'))).toBe(true);
  });

  it.each<[string, Partial<DatabaseRoleFacts>, RegExp]>([
    ['a superuser', { superuser: true }, /superuser/],
    // System access comes from explicit bslt_system policies, never BYPASSRLS.
    ['BYPASSRLS', { bypassRls: true }, /has BYPASSRLS/],
    ['a table owner', { ownsTables: true }, /owns tables/],
    ['unable to reach cross-user rows', { actsAsSystem: false }, /not a member of bslt_system/],
    ['able to SET ROLE to a superuser or BYPASSRLS role', { escalates: true }, /SET ROLE/],
  ])('rejects a worker role that is %s', (_label, override, pattern) => {
    const problems = findRuntimeRoleProblems(app, { ...worker, ...override });
    expect(problems.some((p) => pattern.test(p) && p.includes('WORKER_DATABASE_URL'))).toBe(true);
  });

  it('rejects one login role serving both pools', () => {
    const problems = findRuntimeRoleProblems(app, { ...worker, name: 'bslt_app' });
    expect(problems.some((p) => /same role/.test(p))).toBe(true);
  });

  it('reports every problem at once (legacy single superuser)', () => {
    const superuser = facts({
      name: 'postgres',
      superuser: true,
      bypassRls: true,
      ownsTables: true,
    });
    expect(findRuntimeRoleProblems(superuser, superuser).length).toBeGreaterThanOrEqual(4);
  });
});
