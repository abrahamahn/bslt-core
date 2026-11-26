// main/kernel/storage/src/config.test.ts
import { describe, expect, it } from 'vitest';

import { DEFAULT_STORAGE_MAX_FILE_SIZE } from './config';

describe('storage config defaults', () => {
  it('defines a 10 MiB default max file size', () => {
    expect(DEFAULT_STORAGE_MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
  });
});
