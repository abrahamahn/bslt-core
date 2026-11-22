// main/kernel/db/src/repositories/system/search.test.ts
import { describe, expect, it, vi } from 'vitest';

import {
  countSearchRows,
  probeSearchTable,
  querySearchFacetBuckets,
  querySearchRows,
} from './search';

import type { RawDb } from '../../client';

describe('search repository helpers', () => {
  it('returns false from probeSearchTable when underlying table query rejects', async () => {
    const db = {
      raw: vi.fn().mockRejectedValue(new Error('relation does not exist')),
    } as unknown as RawDb;

    expect(await probeSearchTable(db, 'search_documents')).toBe(false);
  });

  it('propagates DB rejections from querySearchRows, querySearchFacetBuckets, and countSearchRows', async () => {
    const db = {
      raw: vi.fn().mockRejectedValue(new Error('query timeout')),
    } as unknown as RawDb;

    await expect(querySearchRows(db, 'SELECT * FROM t', [])).rejects.toThrow('query timeout');
    await expect(querySearchFacetBuckets(db, 'SELECT x FROM t', [])).rejects.toThrow(
      'query timeout',
    );
    await expect(countSearchRows(db, 'SELECT COUNT(*) FROM t', [])).rejects.toThrow(
      'query timeout',
    );
  });

  it('parses string and numeric counts and probes healthy tables', async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce([{ count: '14' }])
      .mockResolvedValueOnce([{ 1: 1 }]);
    const db = { raw } as unknown as RawDb;

    expect(await countSearchRows(db, 'SELECT COUNT(*)::int AS count FROM t', [])).toBe(14);
    expect(await probeSearchTable(db, 'search_documents')).toBe(true);
  });
});
