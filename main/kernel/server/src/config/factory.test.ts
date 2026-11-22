// main/kernel/server/src/config/factory.test.ts
import fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { load } from './factory';

// Mock filesystem for consistent testing
vi.mock('node:fs');
vi.mock('node:path', async () => {
  const actual = await vi.importActual('node:path');
  return {
    ...actual,
  };
});

describe('Configuration Factory', () => {
  const originalEnv = { ...process.env };
  const validEnv = {
    NODE_ENV: 'test' as const,
    JWT_SECRET: 'a-very-secure-secret-key-32-chars-long!',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    SEARCH_PROVIDER: 'sql' as const,
    PACKAGE_MANAGER_PROVIDER: 'pnpm' as const,
  };

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    process.env = { ...originalEnv };

    // Clear relevant env vars
    delete process.env['JWT_SECRET'];
    delete process.env['DATABASE_URL'];
    delete process.env['NODE_ENV'];
    delete process.env['ENV_FILE'];
    delete process.env['APP_NAME'];
    delete process.env['PUBLIC_API_URL'];
    delete process.env['VITE_API_URL'];

    // Mock filesystem using vi.spyOn to avoid no-sync lint rule
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      const pStr = String(p);
      return pStr.includes('config') || pStr.includes('.env');
    });

    vi.spyOn(fs, 'statSync').mockImplementation((p) => {
      const pStr = String(p);
      if (pStr.endsWith('config')) {
        return { isDirectory: () => true } as fs.Stats;
      }
      return { isDirectory: () => false } as fs.Stats;
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('Basic Loading', () => {
    test('should load full configuration structure', () => {
      const config = load(validEnv);

      expect(config.env).toBe('test');
      expect(config.app.name).toBe('Your App');
      expect(config.auth.jwt.secret).toBe(validEnv.JWT_SECRET);
      expect(config.packageManager.provider).toBe('pnpm');
      expect(config.search.provider).toBe('sql');
    });

    test('should key local storage URL signing off the validated cookie secret', () => {
      const fromJwt = load(validEnv);
      const fromCookie = load({
        ...validEnv,
        COOKIE_SECRET: 'a-distinct-cookie-secret-of-32-chars!!',
      });

      expect(fromJwt.storage.provider === 'local' && fromJwt.storage.signingSecret).toBe(
        fromJwt.auth.cookie.secret,
      );
      expect(fromCookie.storage.provider === 'local' && fromCookie.storage.signingSecret).toBe(
        'a-distinct-cookie-secret-of-32-chars!!',
      );
    });

    test('should always use the sql search provider', () => {
      const sqlConfig = load({ ...validEnv, SEARCH_PROVIDER: 'sql' });
      expect(sqlConfig.search.provider).toBe('sql');
    });
  });

  describe('Environment Priority & Integration', () => {
    test('should respect priority: Stage > Base > Root', () => {
      // Simulate the result of initEnv() loading files in priority order.
      // Stage-specific values override base values (stage loaded first, only sets if absent).
      // Since initEnv() uses priority: system env wins, then first file sets the value.
      const env = {
        ...validEnv,
        NODE_ENV: 'development' as const,
        APP_NAME: 'StageApp', // Stage-specific override wins
      };

      const config = load(env);

      expect(config.env).toBe('development');
      expect(config.app.name).toBe('StageApp');
    });

    test('should support flexible URL resolution (VITE_ vs PUBLIC_)', () => {
      const env = {
        ...validEnv,
        NODE_ENV: 'development' as const,
        API_BASE_URL: 'http://localhost:9000', // Server canonical API URL
      };

      const config = load(env);

      // Server should pick up API_BASE_URL as its apiBaseUrl
      expect(config.server.apiBaseUrl).toBe('http://localhost:9000');
    });
  });

  describe('Validation & Security', () => {
    test('should enforce production security refinements', () => {
      // Short JWT_SECRET fails Zod validation; load() calls process.exit(1)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process Exited');
      });

      expect(() =>
        load({
          NODE_ENV: 'production',
          JWT_SECRET: 'too_short',
          DATABASE_URL: 'postgres://localhost',
        }),
      ).toThrow('Process Exited');
      exitSpy.mockRestore();
    });

    test('should validate URL formats in config', () => {
      // Invalid PUBLIC_API_URL fails Zod validation; load() calls process.exit(1)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process Exited');
      });

      expect(() =>
        load({
          ...validEnv,
          NODE_ENV: 'development' as const,
          PUBLIC_API_URL: 'not-a-url', // INVALID URL
        }),
      ).toThrow('Process Exited');
      exitSpy.mockRestore();
    });

    test('should fail fast on Zod schema validation errors', () => {
      const invalidEnv = { NODE_ENV: 'development' as const }; // Missing JWT_SECRET etc

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });

      expect(() => load(invalidEnv)).toThrow();
      exitSpy.mockRestore();
    });
  });

  describe('Production Hard-Guards', () => {
    const prodBaseEnv = {
      ...validEnv,
      NODE_ENV: 'production' as const,
      PUBLIC_API_URL: 'https://api.my-app.com',
      EMAIL_PROVIDER: 'smtp' as const,
      EMAIL_FROM_ADDRESS: 'no-reply@my-app.com',
      SMTP_HOST: 'smtp.sendgrid.net',
      DB_SSL: 'true',
      APP_URL: 'https://my-app.com',
      WORKER_DATABASE_URL: 'postgresql://worker:pass@localhost:5432/db',
      LISTEN_DATABASE_URL: 'postgresql://worker:pass@localhost:5432/db',
    };

    test('should allow valid production config', () => {
      const config = load(prodBaseEnv);
      expect(config.env).toBe('production');
      if (config.database.provider === 'postgresql') {
        expect(config.database.ssl).toBe(true);
      }
    });

    test('should refuse production without a separate worker database role', () => {
      const badEnv = { ...prodBaseEnv, WORKER_DATABASE_URL: '' };
      expect(() => load(badEnv)).toThrow(/WORKER_DATABASE_URL is required in production/);
    });

    test('should refuse production without a direct pub/sub listener connection', () => {
      const badEnv = { ...prodBaseEnv, LISTEN_DATABASE_URL: '' };
      expect(() => load(badEnv)).toThrow(/LISTEN_DATABASE_URL is required in production/);
    });

    test('should allow explicit non-SSL database config for internal production poolers', () => {
      const badEnv = { ...prodBaseEnv, DB_SSL: 'false' };
      const config = load(badEnv);
      if (config.database.provider === 'postgresql') {
        expect(config.database.ssl).toBe(false);
      }
    });

    test('should forbid console email provider in production', () => {
      const badEnv = { ...prodBaseEnv, EMAIL_PROVIDER: 'console' as const };
      expect(() => load(badEnv)).toThrow(/EMAIL_PROVIDER=console is not allowed in production/);
    });

    test('should reject placeholder production SMTP host', () => {
      const badEnv = { ...prodBaseEnv, SMTP_HOST: 'smtp.example.com' };
      expect(() => load(badEnv)).toThrow(/SMTP_HOST must be set to a real SMTP host/);
    });

    test('should reject placeholder production from address', () => {
      const badEnv = { ...prodBaseEnv, EMAIL_FROM_ADDRESS: 'no-reply@example.com' };
      expect(() => load(badEnv)).toThrow(/EMAIL_FROM_ADDRESS must use your app domain/);
    });

    test('should enforce S3 credentials in production if S3 provider is used', () => {
      const s3Env = {
        ...prodBaseEnv,
        STORAGE_PROVIDER: 's3' as const,
        S3_BUCKET: 'abe-bucket',
        S3_REGION: 'us-east-1',
        // Missing keys
      };
      expect(() => load(s3Env)).toThrow(/S3_ACCESS_KEY_ID is required in production/);
    });

    test('should reject blank discrete Postgres password in production', () => {
      const badEnv = {
        ...prodBaseEnv,
        DATABASE_URL: '',
        POSTGRES_HOST: 'db.internal',
        POSTGRES_USER: 'postgres',
        POSTGRES_PASSWORD: '',
      };

      expect(() => load(badEnv)).toThrow(/POSTGRES_PASSWORD is required in production/);
    });

    test('should reject non-HTTPS app base URL in production', () => {
      const badEnv = { ...prodBaseEnv, APP_URL: 'http://my-app.com' };
      expect(() => load(badEnv)).toThrow(/must be an HTTPS URL in production/);
    });
  });
});
