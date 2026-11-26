// main/kernel/storage/src/factory.test.ts
import { describe, expect, it } from 'vitest';

import { createStorage } from './factory';
import { LocalStorageProvider } from './providers/local';
import { S3StorageProvider } from './providers/s3';

import type { StorageConfig } from './types';

describe('createStorage', () => {
  it('rejects unsupported storage providers and constructs local and S3 providers', () => {
    expect(() => createStorage({ provider: 'gcs' } as unknown as StorageConfig)).toThrow(
      /Unsupported storage provider: gcs/u,
    );

    const local = createStorage({
      provider: 'local',
      rootPath: '/tmp/bslt-storage-factory-test',
      baseUrl: 'http://localhost:8080/uploads',
      signingSecret: 'test-signing-secret-32-chars-min!!',
      maxFileSize: 1024 * 1024,
      allowedTypes: ['image/png'],
    });
    expect(local).toBeInstanceOf(LocalStorageProvider);

    const s3 = createStorage({
      provider: 's3',
      bucket: 'bslt-test',
      region: 'us-east-1',
      accessKeyId: 'AKIA_TEST',
      secretAccessKey: 'SECRET_TEST',
      forcePathStyle: false,
      presignExpiresInSeconds: 300,
      maxFileSize: 1024 * 1024,
      allowedTypes: ['image/png'],
    });
    expect(s3).toBeInstanceOf(S3StorageProvider);
  });
});
