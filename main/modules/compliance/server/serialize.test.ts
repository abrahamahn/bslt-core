// main/modules/compliance/server/serialize.test.ts
import { describe, expect, it } from 'vitest';

import { serializeUserDataExport, userDataExportToCsv, type UserDataExport } from './serialize';

const BASE_EXPORT: UserDataExport = {
  profile: {
    id: 'u-1',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    username: 'ada',
    role: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  consentHistory: [
    {
      consentType: 'analytics',
      granted: true,
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ],
  modules: {
    tasks: {
      tasks: [{ id: 't-1', title: 'Write, "escape"\nme', completed: false }],
    },
  },
  exportedAt: '2026-11-19T00:00:00.000Z',
  format: 'csv',
};

describe('serializeUserDataExport', () => {
  it('escapes commas, quotes, and newlines per RFC 4180 and marks empty sections explicitly', () => {
    const csv = userDataExportToCsv(BASE_EXPORT);
    expect(csv).toContain('# profile\nid,email,firstName');
    expect(csv).toContain('# memberships\n(no records)');
    expect(csv).toContain('# tasks.tasks\nid,title,completed\nt-1,"Write, ""escape""\nme",false');

    const out = serializeUserDataExport(BASE_EXPORT, 'csv');
    expect(out.extension).toBe('csv');
    expect(out.contentType).toBe('text/csv; charset=utf-8');
  });

  it('serializes JSON exports losslessly with application/json content type', () => {
    const out = serializeUserDataExport({ ...BASE_EXPORT, format: 'json' }, 'json');
    expect(out.extension).toBe('json');
    expect(out.contentType).toBe('application/json; charset=utf-8');
    expect(JSON.parse(out.body)).toEqual({ export: { ...BASE_EXPORT, format: 'json' } });
  });
});
