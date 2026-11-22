// main/kernel/server/src/config/infra/storage.test.ts
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadStorageConfig, validateStorage } from './storage';

import type { FullEnv } from '../env/env.validation';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const SIGNING_SECRET = 'storage-config-signing-secret-0123456789';

describe('Storage Configuration', () => {
  describe('Local Provider', () => {
    it('should return local provider with correct default path', () => {
      const config = loadStorageConfig({} as unknown as FullEnv);

      expect(config.provider).toBe('local');
      if (config.provider === 'local') {
        expect(config.rootPath).toContain('main/apps/server/uploads');
        expect(config.publicBaseUrl).toBe('/uploads');
      }
    });

    it('should allow custom storage paths', () => {
      const config = loadStorageConfig({ STORAGE_ROOT_PATH: '/mnt/storage' } as unknown as FullEnv);

      if (config.provider === 'local') {
        expect(config.rootPath).toBe('/mnt/storage');
      }
    });

    it('should load publicBaseUrl correctly', () => {
      const config = loadStorageConfig({
        STORAGE_PUBLIC_BASE_URL: 'http://cdn.abe.com/uploads',
      } as unknown as FullEnv);

      if (config.provider === 'local') {
        expect(config.publicBaseUrl).toBe('http://cdn.abe.com/uploads');
      }
    });

    it('should derive an absolute local publicBaseUrl from the API base URL', () => {
      const config = loadStorageConfig({} as unknown as FullEnv, {
        apiBaseUrl: 'http://localhost:8080',
      });

      if (config.provider === 'local') {
        expect(config.publicBaseUrl).toBe('http://localhost:8080/uploads');
      }
    });

    it('should carry the URL signing secret it is given', () => {
      const config = loadStorageConfig({} as unknown as FullEnv, {
        signingSecret: SIGNING_SECRET,
      });

      expect(config.provider === 'local' && config.signingSecret).toBe(SIGNING_SECRET);
    });

    it('should resolve repo-relative storage paths from nested working directories', () => {
      const previousCwd = process.cwd();
      process.chdir(resolve(REPO_ROOT, 'main/apps/server'));
      try {
        const config = loadStorageConfig({
          STORAGE_ROOT_PATH: 'main/apps/server/uploads',
        } as unknown as FullEnv);

        if (config.provider === 'local') {
          expect(config.rootPath).toContain('main/apps/server/uploads');
          expect(config.rootPath).not.toContain('main/apps/server/main/apps/server');
        }
      } finally {
        process.chdir(previousCwd);
      }
    });
  });

  describe('S3 Provider', () => {
    it('should load full S3 configuration', () => {
      const env = {
        STORAGE_PROVIDER: 's3',
        S3_BUCKET: 'abe-bucket',
        S3_REGION: 'eu-west-1',
        S3_FORCE_PATH_STYLE: 'true',
        S3_PRESIGN_EXPIRES_IN_SECONDS: 7200,
        S3_ENDPOINT: 'https://minio.local',
      } as unknown as FullEnv;

      const config = loadStorageConfig(env);

      expect(config.provider).toBe('s3');
      if (config.provider === 's3') {
        expect(config.bucket).toBe('abe-bucket');
        expect(config.forcePathStyle).toBe(true);
        expect(config.presignExpiresInSeconds).toBe(7200);
        expect(config.endpoint).toBe('https://minio.local');
      }
    });

    it('should use default presign expiry when not provided', () => {
      const config = loadStorageConfig({ STORAGE_PROVIDER: 's3' } as unknown as FullEnv);
      if (config.provider === 's3') {
        expect(config.presignExpiresInSeconds).toBe(3600);
      }
    });
  });

  describe('Validation Logic', () => {
    it('should collect errors for missing S3 bucket and region', () => {
      const config = loadStorageConfig({ STORAGE_PROVIDER: 's3' } as unknown as FullEnv);
      const errors = validateStorage(config, true);

      expect(errors).toContain('S3_BUCKET is required for S3 storage');
      expect(errors).toContain('S3_REGION is required for S3 storage');
    });

    it('should require credentials in production mode', () => {
      const config = loadStorageConfig({
        STORAGE_PROVIDER: 's3',
        S3_BUCKET: 'test',
        S3_REGION: 'us-east-1',
      } as unknown as FullEnv);

      const errors = validateStorage(config, true); // isProd = true

      expect(errors).toContain('S3_ACCESS_KEY_ID is required in production');
      expect(errors).toContain('S3_SECRET_ACCESS_KEY is required in production');
    });

    it('should pass validation with complete config', () => {
      const config = loadStorageConfig({
        STORAGE_PROVIDER: 's3',
        S3_BUCKET: 'test',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY_ID: 'key',
        S3_SECRET_ACCESS_KEY: 'secret',
      } as unknown as FullEnv);

      const errors = validateStorage(config, true);
      expect(errors.length).toBe(0);
    });

    it('should not require a URL signing secret for S3 (S3 presigns its own URLs)', () => {
      const config = loadStorageConfig({
        STORAGE_PROVIDER: 's3',
        S3_BUCKET: 'test',
        S3_REGION: 'us-east-1',
      } as unknown as FullEnv);

      expect(validateStorage(config, false)).toEqual([]);
    });

    describe('local URL signing secret', () => {
      const MESSAGE = /Local storage URL signing secret must be at least 32 characters/;

      it.each([true, false])('fails fast when it is missing (isProd=%s)', (isProd) => {
        const config = loadStorageConfig({} as unknown as FullEnv);

        expect(validateStorage(config, isProd)).toEqual([expect.stringMatching(MESSAGE)]);
      });

      it.each([true, false])(
        'fails fast when it is shorter than 32 chars (isProd=%s)',
        (isProd) => {
          const config = loadStorageConfig({} as unknown as FullEnv, {
            signingSecret: 'x'.repeat(31),
          });

          expect(validateStorage(config, isProd)).toEqual([expect.stringMatching(MESSAGE)]);
        },
      );

      it('passes with a 32+ char secret and never echoes it in errors', () => {
        const ok = loadStorageConfig({} as unknown as FullEnv, { signingSecret: SIGNING_SECRET });
        const short = loadStorageConfig({} as unknown as FullEnv, {
          signingSecret: 'short-secret',
        });

        expect(validateStorage(ok, true)).toEqual([]);
        expect(validateStorage(short, true).join('\n')).not.toContain('short-secret');
      });
    });
  });
});
