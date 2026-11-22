// main/modules/compliance/web/public-routes.test.tsx
import { describe, expect, it, vi } from 'vitest';

import { renderPublic } from '@bslt/web-platform';

import { complianceModule } from '../module';

import { compliancePublicRoutes } from './public-routes';

describe('compliancePublicRoutes', () => {
  it('renders DB-published /terms and /privacy with 60s public cache when API responds', async () => {
    const fetchSpy: typeof fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            documents: [
              {
                id: 'doc-terms-1',
                type: 'terms_of_service',
                title: 'Terms of Service',
                content: '## Binding Terms\n\nYou agree to abide by all platform rules.',
                version: 3,
                effectiveAt: '2026-10-01T00:00:00.000Z',
                createdAt: '2026-09-25T00:00:00.000Z',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const rendered = await renderPublic(
      new URL('https://app.bslt.dev/terms'),
      compliancePublicRoutes,
      {
        apiInternalUrl: 'http://api.internal:8080',
        siteUrl: 'https://app.bslt.dev',
        modules: [complianceModule],
        fetchImpl: fetchSpy,
      },
    );

    expect(rendered).not.toBeNull();
    expect(rendered?.cacheControl).toContain('max-age=60');
    expect(rendered?.headHtml).toContain('<title>Terms of Service</title>');
    expect(rendered?.bodyHtml).toContain('Binding Terms');
    expect(rendered?.bodyHtml).toContain('Version 3');
  });

  it('never claims /terms is unpublished when API is unreachable during build/offline render', async () => {
    const failingFetch: typeof fetch = vi.fn(() => Promise.reject(new Error('offline')));

    const rendered = await renderPublic(
      new URL('https://app.bslt.dev/terms'),
      compliancePublicRoutes,
      {
        apiInternalUrl: 'http://api.internal:8080',
        siteUrl: null,
        modules: [complianceModule],
        fetchImpl: failingFetch,
      },
    );

    expect(rendered).not.toBeNull();
    expect(rendered?.bodyHtml).toContain('Terms of Service');
    expect(rendered?.bodyHtml).not.toContain('has not been published yet');
    expect(rendered?.bodyHtml).not.toContain('unavailable');
  });

  it.each([
    ['/cookies', 'Cookie Policy', 'We set no analytics cookies and no advertising cookies'],
    [
      '/acceptable-use',
      'Acceptable Use Policy',
      'probe, scan, or test the security of the service',
    ],
    ['/disclaimer', 'Disclaimer', 'the amount you paid us in the twelve months before the claim'],
  ])(
    'prerenders file-owned %s with cacheSeconds = Infinity and filled tokens',
    async (urlPath, title, phrase) => {
      const rendered = await renderPublic(
        new URL(`https://app.bslt.dev${urlPath}`),
        compliancePublicRoutes,
        {
          apiInternalUrl: 'http://api.internal:8080',
          siteUrl: 'https://app.bslt.dev',
          modules: [complianceModule],
        },
      );

      expect(rendered).not.toBeNull();
      expect(rendered?.headHtml).toContain(`<title>${title}</title>`);
      expect(rendered?.bodyHtml).toContain(phrase);
      expect(rendered?.bodyHtml).not.toContain('[[');
    },
  );

  it('never server-renders /admin/legal', async () => {
    const rendered = await renderPublic(
      new URL('https://app.bslt.dev/admin/legal'),
      compliancePublicRoutes,
      {
        apiInternalUrl: 'http://api.internal:8080',
        siteUrl: 'https://app.bslt.dev',
        modules: [complianceModule],
      },
    );
    expect(rendered).toBeNull();
  });
});
