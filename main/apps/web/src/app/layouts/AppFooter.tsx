// main/apps/web/src/app/layouts/AppFooter.tsx
/**
 * The site footer: the public pages, grouped by section, plus the one-liner.
 *
 * Every link comes from the site map, and only ever through `liveSiteSections()`
 * — which hands back `LiveSitePage`s, the only thing this file can render. A
 * page whose route does not exist yet is not merely skipped here: it cannot be
 * typed into a link at all, so the footer is structurally incapable of
 * advertising a 404. Adding a link is an entry in siteMap.ts, not an edit here.
 */

import { Link } from '@bslt/react/router';
import { Heading, Text } from '@bslt/ui';
import { clientConfig } from '@config';
import { DoNotSellControl } from '@settings/components/DoNotSellControl';

import { PRODUCT_TAGLINE, SITE_MAP, liveSiteSections } from '../siteMap';

import type { SitePage } from '../siteMap';
import type { ReactElement } from 'react';

export interface AppFooterProps {
  /** The site map. Injectable so a fork — and the tests — can drive a different one. */
  pages?: readonly SitePage[];
}

export const AppFooter = ({ pages = SITE_MAP }: AppFooterProps): ReactElement => (
  <footer className="border-t p-4 flex flex-col gap-4">
    <nav
      aria-label="Footer"
      style={{
        display: 'grid',
        gap: 'var(--ui-gap-4, 1rem)',
        gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
      }}
    >
      {liveSiteSections(pages).map(({ section, pages: sectionPages }) => (
        <div key={section.id} className="flex flex-col gap-2">
          <Heading as="h2" size="sm">
            {section.label}
          </Heading>
          {sectionPages.map((page) => (
            <Link key={page.path} to={page.path} className="no-underline">
              <Text as="span" size="sm" tone="muted">
                {page.title}
              </Text>
            </Link>
          ))}
        </div>
      ))}
    </nav>
    {/* The CPRA opt-out, IN the footer rather than linked from it: §7026
        forbids requiring an account or a login to opt out, and /settings is a
        protected route. The footer is on every page (AppLayout in the browser,
        ServerApp in the prerender), so the anchor #do-not-sell always resolves. */}
    <DoNotSellControl compact />
    <Text size="xs" tone="muted">
      {`© ${new Date().getFullYear().toString()} ${clientConfig.appName} · ${PRODUCT_TAGLINE}`}
    </Text>
  </footer>
);
