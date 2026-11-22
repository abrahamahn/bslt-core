// main/apps/web/src/app/shells/SiteFooter.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PRODUCT_TAGLINE, SITE_MAP, type SitePage } from '../siteMap';

import { SiteFooter } from './SiteFooter';

import type { ReactElement, ReactNode } from 'react';

vi.mock('@bslt/react/router', () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }): ReactElement => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('@bslt/identity/web', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/identity/web')>();
  return {
    ...actual,
    useAuth: () => ({ user: null }),
  };
});
vi.mock('@bslt/compliance/web', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/compliance/web')>();
  return {
    ...actual,
    useUpdateConsent: () => ({ updateConsent: vi.fn() }),
  };
});

const LIVE_PAGE: SitePage = {
  path: '/live-page',
  title: 'Live page',
  section: 'product',
  live: true,
};
const DARK_PAGE: SitePage = {
  path: '/dark-page',
  title: 'Dark page',
  section: 'product',
  live: false,
};
const DARK_SECTION_PAGE: SitePage = {
  path: '/dark-legal',
  title: 'Dark legal page',
  section: 'legal',
  live: false,
};

describe('SiteFooter', () => {
  it('links live pages and omits dark pages and empty sections', () => {
    render(<SiteFooter pages={[LIVE_PAGE, DARK_PAGE, DARK_SECTION_PAGE]} />);

    expect(screen.getByRole('link', { name: LIVE_PAGE.title })).toHaveAttribute(
      'href',
      LIVE_PAGE.path,
    );
    expect(screen.queryByRole('link', { name: DARK_PAGE.title })).toBeNull();
    expect(screen.queryByText(DARK_PAGE.title)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Legal' })).toBeNull();
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).not.toContain(DARK_PAGE.path);
    expect(hrefs).not.toContain(DARK_SECTION_PAGE.path);
  });

  it('links every live entry in SITE_MAP and renders product tagline plus CPRA opt-out', () => {
    render(<SiteFooter />);

    for (const page of SITE_MAP) {
      const link = screen.queryByRole('link', { name: page.title });
      if (page.live) {
        expect(link).toHaveAttribute('href', page.path);
      } else {
        expect(link).toBeNull();
      }
    }
    expect(screen.getByText(new RegExp(PRODUCT_TAGLINE, 'u'))).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: /Do Not Sell or Share My Personal Information/i }),
    ).toBeInTheDocument();
    expect(document.getElementById('do-not-sell')).not.toBeNull();
  });
});
