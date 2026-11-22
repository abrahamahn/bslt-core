// main/kernel/db/src/utils/cursor.test.ts
import { describe, expect, it } from 'vitest';

import {
  createCursorForItem,
  decodeCursor,
  encodeCursor,
  getSortableValue,
  isCursorValue,
  type CursorData,
} from './cursor';

describe('Cursor Encoding/Decoding', () => {
  it('should encode and decode cursor data correctly', () => {
    const data: CursorData = {
      value: '2024-01-01T00:00:00Z',
      tieBreaker: '123',
      sortOrder: 'desc',
    };

    const encoded = encodeCursor(data);
    const decoded = decodeCursor(encoded);

    expect(decoded).toEqual(data);
  });

  it('should handle different sort orders', () => {
    const data: CursorData = {
      value: '2024-01-01T00:00:00Z',
      tieBreaker: '123',
      sortOrder: 'asc',
    };

    const encoded = encodeCursor(data);
    const decoded = decodeCursor(encoded);

    expect(decoded!.sortOrder).toBe('asc');
  });

  it('should return null for invalid cursor format', () => {
    expect(decodeCursor('invalid-cursor')).toBeNull();
  });

  it('should handle numeric values', () => {
    const data: CursorData = {
      value: 100,
      tieBreaker: '123',
      sortOrder: 'desc',
    };

    const encoded = encodeCursor(data);
    const decoded = decodeCursor(encoded);

    expect(decoded!.value).toBe(100);
  });
});

describe('decodeCursor — adversarial', () => {
  it('returns null for empty string', () => {
    expect(decodeCursor('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(decodeCursor('   ')).toBeNull();
  });

  it('returns null for a plain non-base64 string', () => {
    expect(decodeCursor('not!!base64@@')).toBeNull();
  });

  it('returns null for valid base64 that is not JSON', () => {
    const notJson = Buffer.from('hello world', 'utf8').toString('base64url');
    expect(decodeCursor(notJson)).toBeNull();
  });

  it('returns null for valid JSON primitive', () => {
    const encoded = Buffer.from('42', 'utf8').toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('returns null for valid JSON null', () => {
    const encoded = Buffer.from('null', 'utf8').toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('returns null for array cursor with missing tieBreaker', () => {
    const payload = JSON.stringify(['value', '', 'asc']);
    const encoded = Buffer.from(payload, 'utf8').toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('returns null for invalid sortOrder in array format', () => {
    const payload = JSON.stringify(['value', 'tie-123', 'random']);
    const encoded = Buffer.from(payload, 'utf8').toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('returns null for invalid sortOrder in object format', () => {
    const payload = JSON.stringify({ value: 'v', tieBreaker: 'tb', sortOrder: 'DESC' });
    const encoded = Buffer.from(payload, 'utf8').toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('returns null for object cursor missing tieBreaker', () => {
    const payload = JSON.stringify({ value: 'v', sortOrder: 'asc' });
    const encoded = Buffer.from(payload, 'utf8').toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('returns null for additionalValues containing null entry', () => {
    const payload = JSON.stringify(['value', 'tie', 'asc', [null]]);
    const encoded = Buffer.from(payload, 'utf8').toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('returns null for additionalValues that is not an array', () => {
    const payload = JSON.stringify(['value', 'tie', 'asc', 'not-an-array']);
    const encoded = Buffer.from(payload, 'utf8').toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('returns null for cursor containing SQL injection attempt', () => {
    const sqlInjection = "'; DROP TABLE users; --";
    const encoded = Buffer.from(sqlInjection, 'utf8').toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('decodes cursor with Date value round-trip', () => {
    const date = new Date('2024-06-15T12:00:00.000Z');
    const data: CursorData = { value: date, tieBreaker: 'abc', sortOrder: 'asc' };
    const encoded = encodeCursor(data);
    const decoded = decodeCursor(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.value).toBeInstanceOf(Date);
    expect((decoded!.value as Date).toISOString()).toBe(date.toISOString());
  });

  it('returns null for dateIso with invalid date string', () => {
    const payload = JSON.stringify([{ dateIso: 'not-a-date' }, 'tie', 'asc']);
    const encoded = Buffer.from(payload, 'utf8').toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });
});

describe('createCursorForItem — adversarial', () => {
  it('throws when sort field is missing from item', () => {
    expect(() => createCursorForItem({ id: '1', name: 'Test' }, 'createdAt', 'asc')).toThrow(
      'Item missing or has invalid sort field: createdAt',
    );
  });

  it('throws when sort field value is null', () => {
    expect(() => createCursorForItem({ id: '1', createdAt: null }, 'createdAt', 'desc')).toThrow(
      'Item missing or has invalid sort field: createdAt',
    );
  });

  it('throws when tieBreaker field is null', () => {
    expect(() =>
      createCursorForItem({ id: null, createdAt: '2024-01-01' }, 'createdAt', 'asc'),
    ).toThrow('Invalid tie-breaker field: id. Must be string or number.');
  });

  it('succeeds when tieBreaker is a numeric ID', () => {
    const cursor = createCursorForItem({ id: 42, createdAt: '2024-01-01' }, 'createdAt', 'asc');
    expect(typeof cursor).toBe('string');
    expect(cursor.length).toBeGreaterThan(0);
  });
});

describe('getSortableValue & isCursorValue — adversarial', () => {
  it('throws for missing key or null/boolean/array values', () => {
    expect(() => getSortableValue({ id: '1' }, 'missingKey')).toThrow(
      'Invalid sort value for key "missingKey"',
    );
    expect(() => getSortableValue({ score: null }, 'score')).toThrow(
      'Invalid sort value for key "score"',
    );
    expect(() => getSortableValue({ active: false }, 'active')).toThrow(
      'Invalid sort value for key "active"',
    );
    expect(() => getSortableValue({ tags: ['a'] }, 'tags')).toThrow(
      'Invalid sort value for key "tags"',
    );
  });

  it('validates cursor primitive types', () => {
    expect(isCursorValue(null)).toBe(false);
    expect(isCursorValue(undefined)).toBe(false);
    expect(isCursorValue({})).toBe(false);
    expect(isCursorValue(true)).toBe(false);
    expect(isCursorValue([])).toBe(false);
    expect(isCursorValue(0)).toBe(true);
    expect(isCursorValue(new Date())).toBe(true);
  });

  it('survives additionalValues round-trip and emits URL-safe base64', () => {
    const date = new Date('2024-01-01T00:00:00.000Z');
    const data: CursorData = {
      value: 'primary',
      tieBreaker: 'tb',
      sortOrder: 'asc',
      additionalValues: [42, 'extra', date],
    };
    const encoded = encodeCursor(data);
    expect(encoded).not.toMatch(/[+/=]/);
    const decoded = decodeCursor(encoded);
    expect(decoded!.additionalValues).toHaveLength(3);
    expect(decoded!.additionalValues![2]).toBeInstanceOf(Date);
  });
});
