// main/modules/compliance/web/index.test.ts
import { describe, expect, it } from 'vitest';

import { complianceWeb } from './index';

describe('complianceWeb', () => {
  it('registers all public legal routes, unlisted aliases, admin legal surface, and sitePages with DB document metadata', () => {
    const routePaths = complianceWeb.routes.map((r) => r.path);
    expect(routePaths).toEqual([
      '/terms',
      '/terms-of-service',
      '/privacy',
      '/privacy-policy',
      '/cookies',
      '/cookie-policy',
      '/acceptable-use',
      '/disclaimer',
      '/admin/legal',
    ]);

    const unlisted = complianceWeb.routes.filter((r) => r.unlisted === true).map((r) => r.path);
    expect(unlisted).toEqual(['/terms-of-service', '/privacy-policy', '/cookie-policy']);

    expect(complianceWeb.admin).toHaveLength(1);
    expect(complianceWeb.admin?.[0]?.id).toBe('legal');

    const termsSitePage = complianceWeb.sitePages?.find((p) => p.path === '/terms');
    expect(termsSitePage?.document).toBe('terms_of_service');
    const cookiesSitePage = complianceWeb.sitePages?.find((p) => p.path === '/cookies');
    expect(cookiesSitePage?.document).toBeUndefined();

    expect(complianceWeb.settings).toEqual([
      expect.objectContaining({
        id: 'data-controls',
        kind: 'modal',
        aliases: ['data', 'privacy'],
        order: 70,
      }),
      expect.objectContaining({
        id: 'legal',
        kind: 'modal',
        order: 100,
      }),
    ]);
  });
});
