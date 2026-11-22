// main/kernel/server/src/testing/database/provisioning.test.ts
import { DB_ROLES } from '@bslt/db';
import { describe, expect, it } from 'vitest';

import {
  describeHarnessAdminProblem,
  resolveHarnessProvisioning,
  type HarnessEnv,
} from './provisioning';

const SUPERUSER_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const SUPERUSER_PARTS: HarnessEnv = {
  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: '5432',
  POSTGRES_USER: 'postgres',
  POSTGRES_PASSWORD: 'postgres',
  POSTGRES_DB: 'postgres',
};
const SUPERUSER_PARTS_DSN = 'postgres://postgres:postgres@127.0.0.1:5432/postgres';

const APP_PASSWORD = 'app-password-0123456789ab';
const OWNER_PASSWORD = 'owner-password-0123456789';
const WORKER_PASSWORD = 'worker-password-0123456789';
const APP_URL = `postgresql://bslt_app:${APP_PASSWORD}@127.0.0.1:5432/app`;
const OWNER_URL = `postgresql://bslt_owner:${OWNER_PASSWORD}@127.0.0.1:5432/app`;
const WORKER_URL = `postgresql://bslt_worker:${WORKER_PASSWORD}@127.0.0.1:5432/app`;
const ADMIN_URL = 'postgresql://admin:admin-secret@127.0.0.1:5432/app';

const SPLIT: HarnessEnv = {
  DATABASE_URL: APP_URL,
  MIGRATION_DATABASE_URL: OWNER_URL,
  WORKER_DATABASE_URL: WORKER_URL,
};

function userOf(connectionString: string): string {
  return decodeURIComponent(new URL(connectionString).username);
}

function failure(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}

describe('resolveHarnessProvisioning', () => {
  describe('no role split configured (the base connection is the superuser)', () => {
    it('DATABASE_URL only: provisions through it and derives the role passwords', () => {
      const resolved = resolveHarnessProvisioning({ DATABASE_URL: SUPERUSER_URL }, SUPERUSER_URL);

      expect(resolved.adminConnectionString).toBe(SUPERUSER_URL);
      expect(resolved.adminSource).toMatch(/DATABASE_URL/);
      const passwords = Object.values(resolved.passwords);
      expect(new Set(passwords).size).toBe(3);
      for (const password of passwords) {
        expect(password).toMatch(/^[\x20-\x7E]{16,}$/);
      }
    });

    it('POSTGRES_* only: provisions through the DSN built from the parts', () => {
      const resolved = resolveHarnessProvisioning(SUPERUSER_PARTS, SUPERUSER_PARTS_DSN);
      expect(resolved.adminConnectionString).toBe(SUPERUSER_PARTS_DSN);
    });

    it('derives the same passwords on every call, so parallel suites agree', () => {
      const first = resolveHarnessProvisioning(SUPERUSER_PARTS, SUPERUSER_PARTS_DSN);
      const second = resolveHarnessProvisioning(SUPERUSER_PARTS, SUPERUSER_PARTS_DSN);
      expect(second.passwords).toEqual(first.passwords);
    });

    it('an explicit DATABASE_ADMIN_URL wins over the base connection', () => {
      const resolved = resolveHarnessProvisioning(
        {
          DATABASE_URL: 'postgresql://someone:pw@127.0.0.1:5432/app',
          DATABASE_ADMIN_URL: ADMIN_URL,
        },
        'postgresql://someone:pw@127.0.0.1:5432/app',
      );
      expect(resolved.adminConnectionString).toBe(ADMIN_URL);
      expect(resolved.adminSource).toBe('DATABASE_ADMIN_URL');
    });
  });

  describe('role split configured in env', () => {
    it('with DATABASE_ADMIN_URL: provisions through it, never the app-role DATABASE_URL', () => {
      const resolved = resolveHarnessProvisioning(
        { ...SPLIT, DATABASE_ADMIN_URL: ADMIN_URL },
        APP_URL,
      );

      expect(resolved.adminConnectionString).toBe(ADMIN_URL);
      expect(resolved.adminSource).toBe('DATABASE_ADMIN_URL');
      expect(resolved.passwords).toEqual({
        owner: OWNER_PASSWORD,
        app: APP_PASSWORD,
        worker: WORKER_PASSWORD,
      });
    });

    it('without DATABASE_ADMIN_URL: provisions through the POSTGRES_* superuser', () => {
      const resolved = resolveHarnessProvisioning({ ...SPLIT, ...SUPERUSER_PARTS }, APP_URL);

      expect(resolved.adminConnectionString).toBe(SUPERUSER_PARTS_DSN);
      expect(resolved.adminSource).toBe('POSTGRES_*');
      expect(userOf(resolved.adminConnectionString)).not.toBe(DB_ROLES.app);
    });

    it('with neither DATABASE_ADMIN_URL nor POSTGRES_*: refuses instead of guessing a server', () => {
      const message = failure(() => resolveHarnessProvisioning(SPLIT, APP_URL));

      expect(message).toMatch(/DATABASE_ADMIN_URL/);
      expect(message).toMatch(/POSTGRES_/);
      expect(message).not.toContain(APP_PASSWORD);
    });
  });

  describe('partly configured role split', () => {
    it.each([
      ['DATABASE_URL names bslt_app, nothing else set', { DATABASE_URL: APP_URL }, APP_URL],
      [
        'DATABASE_URL names bslt_app and only the worker URL is set',
        { DATABASE_URL: APP_URL, WORKER_DATABASE_URL: WORKER_URL },
        APP_URL,
      ],
      [
        'the base connection names bslt_worker',
        { DATABASE_URL: WORKER_URL, ...SUPERUSER_PARTS },
        WORKER_URL,
      ],
      [
        'the base connection names bslt_owner',
        { DATABASE_URL: OWNER_URL, ...SUPERUSER_PARTS },
        OWNER_URL,
      ],
    ] as ReadonlyArray<readonly [string, HarnessEnv, string]>)(
      'never uses a runtime role as the admin: %s',
      (_label, env, base) => {
        const message = failure(() => resolveHarnessProvisioning(env, base));

        expect(message).toMatch(/MIGRATION_DATABASE_URL|WORKER_DATABASE_URL|DATABASE_URL/);
        expect(message).not.toBe('');
        expect(message).not.toMatch(/password-0123456789/);
      },
    );

    it('only one of the owner/worker URLs set beside a superuser DATABASE_URL: refuses', () => {
      const message = failure(() =>
        resolveHarnessProvisioning(
          { DATABASE_URL: SUPERUSER_URL, WORKER_DATABASE_URL: WORKER_URL },
          SUPERUSER_URL,
        ),
      );
      expect(message).toMatch(/MIGRATION_DATABASE_URL/);
    });

    it('owner and worker URLs set but DATABASE_URL still names the superuser: refuses', () => {
      const message = failure(() =>
        resolveHarnessProvisioning(
          { ...SPLIT, DATABASE_URL: SUPERUSER_URL, ...SUPERUSER_PARTS },
          SUPERUSER_URL,
        ),
      );
      expect(message).toMatch(/DATABASE_URL must connect as bslt_app/);
    });

    it('a role URL that names the wrong role: refuses without echoing its password', () => {
      const message = failure(() =>
        resolveHarnessProvisioning(
          {
            ...SPLIT,
            ...SUPERUSER_PARTS,
            WORKER_DATABASE_URL: `postgresql://postgres:${WORKER_PASSWORD}@127.0.0.1:5432/app`,
          },
          APP_URL,
        ),
      );
      expect(message).toMatch(/WORKER_DATABASE_URL must connect as bslt_worker/);
      expect(message).not.toContain(WORKER_PASSWORD);
    });
  });

  describe('values loaded from config/env files (initEnv fills process.env before the harness reads it)', () => {
    it('the checked-in .env.test shape (blank DATABASE_URL, POSTGRES_* superuser) is the un-split case', () => {
      const resolved = resolveHarnessProvisioning(
        { DATABASE_URL: '', ...SUPERUSER_PARTS },
        SUPERUSER_PARTS_DSN,
      );
      expect(resolved.adminConnectionString).toBe(SUPERUSER_PARTS_DSN);
    });

    it('a split written to the env file is honoured exactly like one in the shell', () => {
      const resolved = resolveHarnessProvisioning({ ...SPLIT, ...SUPERUSER_PARTS }, APP_URL);
      expect(resolved.adminSource).toBe('POSTGRES_*');
      expect(resolved.passwords.app).toBe(APP_PASSWORD);
    });
  });
});

describe('describeHarnessAdminProblem', () => {
  it('accepts a superuser', () => {
    expect(describeHarnessAdminProblem({ name: 'postgres', superuser: true }, 'POSTGRES_*')).toBe(
      null,
    );
  });

  it('names the role, where it came from and how to fix it when it is not a superuser', () => {
    const problem = describeHarnessAdminProblem(
      { name: 'bslt_app', superuser: false },
      'DATABASE_ADMIN_URL',
    );
    expect(problem).toMatch(/"bslt_app"/);
    expect(problem).toMatch(/DATABASE_ADMIN_URL/);
    expect(problem).toMatch(/superuser/);
    expect(problem).toMatch(/create roles/);
  });
});
