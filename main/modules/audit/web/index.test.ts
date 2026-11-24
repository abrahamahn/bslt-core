// main/modules/audit/web/index.test.ts
import { describe, expect, it } from 'vitest';

import enUsMessages from '../i18n/en-US.json';

import { auditWeb } from './index';

describe('auditWeb', () => {
  it('registers user activity route and admin audit + security routes, nav, and messages', () => {
    expect(auditWeb.module.id).toBe('audit');
    expect(auditWeb.routes.map((r) => r.path)).toEqual([
      '/activities',
      '/workspace/audit',
      '/admin/security',
      '/admin/security/:id',
      '/admin/audit',
    ]);
    expect(auditWeb.routes.find((r) => r.path === '/activities')?.auth).toBe('user');
    expect(auditWeb.routes.find((r) => r.path === '/workspace/audit')?.auth).toBe('user');
    expect(auditWeb.routes.find((r) => r.path === '/workspace/audit')?.unlisted).toBe(true);
    expect(auditWeb.routes.find((r) => r.path === '/admin/audit')?.auth).toBe('admin');
    expect(auditWeb.routes.find((r) => r.path === '/admin/security/:id')?.unlisted).toBe(true);
    expect(auditWeb.admin?.map((a) => a.id)).toEqual(['security', 'audit']);
    expect(auditWeb.nav?.map((n) => n.slot)).toEqual(['app.primary', 'palette']);
    expect(Object.keys(auditWeb.messages ?? {}).length).toBe(Object.keys(enUsMessages).length);
  });
});
