// main/apps/web/src/ssr/PublicDocumentShell.tsx
/**
 * Lean `PublicShell` chrome used identically by `renderPublic` (server) and
 * `hydratePublic` (`entry-public.tsx`), with zero `AuthService` or 17-module
 * `webApp` imports so the public bundle stays small and hydrates node-for-node.
 */

import { DoNotSellControl } from '@bslt/compliance/web';
import { Link, useLocation } from '@bslt/react/router';
import { Heading, Text, TopbarLayout } from '@bslt/ui';
import { DEFAULT_SITE_SECTIONS, type SiteSectionId } from '@bslt/web-platform';

import type { ReactElement, ReactNode } from 'react';

import { PRODUCT_TAGLINE } from '#app/app/productMeta';
import '#app/app/shells/Shells.css';
import { clientConfig } from '#app/config';

interface PublicFooterLink {
  readonly path: `/${string}`;
  readonly title: string;
  readonly section: SiteSectionId;
}

const PUBLIC_PRIMARY_LINKS: readonly { readonly label: string; readonly to: `/${string}` }[] = [
  { label: 'Home', to: '/' },
  { label: 'Changelog', to: '/changelog' },
  { label: 'Support', to: '/support' },
  { label: 'Status', to: '/status' },
];

const PUBLIC_FOOTER_LINKS: readonly PublicFooterLink[] = [
  { path: '/', title: 'Home', section: 'product' },
  { path: '/changelog', title: 'Changelog', section: 'product' },
  { path: '/terms', title: 'Terms of Service', section: 'legal' },
  { path: '/privacy', title: 'Privacy Policy', section: 'legal' },
  { path: '/cookies', title: 'Cookie Policy', section: 'legal' },
  { path: '/acceptable-use', title: 'Acceptable Use Policy', section: 'legal' },
  { path: '/disclaimer', title: 'Disclaimer', section: 'legal' },
  { path: '/support', title: 'Support', section: 'support' },
  { path: '/report', title: 'Report Content', section: 'support' },
  { path: '/status', title: 'Status', section: 'support' },
];

const COPYRIGHT_YEAR = '2026';

interface PublicDocumentShellProps {
  readonly children?: ReactNode;
}

export const PublicDocumentShell = ({ children }: PublicDocumentShellProps): ReactElement => {
  const location = useLocation();

  const leftSection = (
    <div className="shell-header__left">
      <Link to="/" className="shell-header__brand-link">
        <span className="shell-header__brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none">
            <path d="m16 2 12 7v14l-12 7-12-7V9Z" fill="currentColor" />
            <path d="m4 9 12 7 12-7M16 16v14" stroke="var(--ui-color-bg)" strokeWidth="1.5" />
            <path d="m10 5.5 12 7" stroke="var(--ui-color-bg)" strokeWidth="1.5" />
          </svg>
        </span>
        <span className="shell-header__title">{clientConfig.appName}</span>
      </Link>
    </div>
  );

  const centerSection = (
    <nav aria-label="Primary" className="shell-header__public-nav">
      {PUBLIC_PRIMARY_LINKS.map((link) => {
        const isActive =
          link.to === '/'
            ? location.pathname === '/'
            : location.pathname === link.to || location.pathname.startsWith(`${link.to}/`);
        return (
          <Link
            key={link.to}
            to={link.to}
            className="shell-header__public-link"
            aria-current={isActive ? 'page' : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );

  const rightSection = (
    <div className="shell-header__right">
      <Link to="/login" className="btn btn-text btn-small no-underline">
        Login
      </Link>
      <Link to="/register" className="btn btn-primary btn-small no-underline">
        Register
      </Link>
    </div>
  );

  return (
    <div className="shell-public" data-shell="public">
      <TopbarLayout
        height="3.5rem"
        data-testid="app-top-panel"
        left={leftSection}
        center={centerSection}
        right={rightSection}
      />
      <main id="main-content" className="shell-public__main">
        <div className="shell-public__content">{children}</div>
        <footer className="shell-footer">
          <nav aria-label="Footer" className="shell-footer__nav">
            {DEFAULT_SITE_SECTIONS.map((section) => {
              const sectionLinks = PUBLIC_FOOTER_LINKS.filter(
                (item) => item.section === section.id,
              );
              if (sectionLinks.length === 0) return null;
              return (
                <div key={section.id} className="flex flex-col gap-2">
                  <Heading as="h2" size="sm">
                    {section.label}
                  </Heading>
                  {sectionLinks.map((item) => (
                    <Link key={item.path} to={item.path} className="no-underline">
                      <Text as="span" size="sm" tone="muted">
                        {item.title}
                      </Text>
                    </Link>
                  ))}
                </div>
              );
            })}
          </nav>
          <DoNotSellControl compact anonymous />
          <Text size="xs" tone="muted">
            {`© ${COPYRIGHT_YEAR} ${clientConfig.appName} · ${PRODUCT_TAGLINE}`}
          </Text>
        </footer>
      </main>
    </div>
  );
};
