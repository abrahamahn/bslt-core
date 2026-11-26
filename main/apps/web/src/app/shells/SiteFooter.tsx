// main/apps/web/src/app/shells/SiteFooter.tsx
/**
 * Site footer rendered on public and workspace shells: grouped live site-map
 * sections, CPRA `#do-not-sell` opt-out control, and product copyright line.
 */

import { DoNotSellControl } from '@bslt/compliance/web';
import { Link } from '@bslt/react/router';
import { Heading, Text } from '@bslt/ui';

import { PRODUCT_TAGLINE, SITE_MAP, liveSiteSections } from '../siteMap';

import './Shells.css';

import type { SitePage } from '../siteMap';
import type { ReactElement } from 'react';

import { clientConfig } from '#app/config';
import { useChromeTranslation } from '#app/i18n/chromeLabels';

interface SiteFooterProps {
  readonly pages?: readonly SitePage[];
}

export const SiteFooter = ({ pages = SITE_MAP }: SiteFooterProps): ReactElement => {
  const { translateSitePage, translateSiteSection } = useChromeTranslation();
  return (
    <footer className="shell-footer">
      <nav aria-label="Footer" className="shell-footer__nav">
        {liveSiteSections(pages).map(({ section, pages: sectionPages }) => (
          <div key={section.id} className="flex flex-col gap-2">
            <Heading as="h2" size="sm">
              {translateSiteSection(section.id, section.label)}
            </Heading>
            {sectionPages.map((page) => (
              <Link key={page.path} to={page.path} className="no-underline">
                <Text as="span" size="sm" tone="muted">
                  {translateSitePage(page.path, page.title)}
                </Text>
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <DoNotSellControl compact />
      <Text size="xs" tone="muted">
        {`© ${new Date().getFullYear().toString()} ${clientConfig.appName} · ${PRODUCT_TAGLINE}`}
      </Text>
    </footer>
  );
};
