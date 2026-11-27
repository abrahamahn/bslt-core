// main/apps/web/src/app/shells/PrimaryNavMenu.tsx
import { isAdmin } from '@bslt/identity/contract';
import { useAuth } from '@bslt/identity/web';
import { Link, useLocation } from '@bslt/react/router';
import { BottombarLayout, MenuItem, ScrollArea, Skeleton, Text } from '@bslt/ui';
import { useCapabilities } from '@bslt/web-platform';
import { useMemo, type ReactElement } from 'react';

import { getPrimaryNavHints, getPrimaryNavLinks, type PrimaryNavLink } from './primaryNav';
import './Shells.css';

import type { FeatureHintProps } from '#app/app/components';

import { FeatureHint } from '#app/app/components';
import { deriveAppRouteFlags } from '#app/app/routeFlags';
import { useChromeTranslation } from '#app/i18n/chromeLabels';

type HintConfig = Pick<FeatureHintProps, 'featureKey' | 'title' | 'description' | 'placement'>;

const HINT_MAP: Record<string, HintConfig> = Object.fromEntries(
  Object.entries(getPrimaryNavHints()).map(([label, hint]) => [
    label,
    { ...hint, placement: 'right' as const },
  ]),
);

function isLinkActive(pathname: string, to: string): boolean {
  const targetPath = to.split('?')[0] ?? to;
  if (targetPath === '/') {
    return pathname === '/';
  }
  if (targetPath === '/settings' && pathname === '/profile') {
    return true;
  }
  if (
    targetPath === '/organization' &&
    (pathname === '/workspace' || pathname.startsWith('/workspace/'))
  ) {
    return true;
  }
  return pathname === targetPath || pathname.startsWith(`${targetPath}/`);
}

function NavGlyph({ to }: { readonly to: string }): ReactElement {
  const targetPath = to.split('?')[0] ?? to;
  switch (targetPath) {
    case '/dashboard':
      return (
        <svg
          className="shell-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case '/projects':
      return (
        <svg
          className="shell-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="9" y1="4" x2="9" y2="20" />
          <line x1="15" y1="4" x2="15" y2="20" />
          <line x1="3" y1="9" x2="21" y2="9" />
        </svg>
      );
    case '/ai':
      return (
        <svg
          className="shell-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden="true"
        >
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
          <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
        </svg>
      );
    case '/referrals':
      return (
        <svg
          className="shell-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden="true"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
      );
    case '/tasks':
      return (
        <svg
          className="shell-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden="true"
        >
          <path d="M9 11l3 3 8-8" />
          <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
        </svg>
      );
    case '/files':
      return (
        <svg
          className="shell-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden="true"
        >
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        </svg>
      );
    case '/organization':
      return (
        <svg
          className="shell-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden="true"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case '/activities':
      return (
        <svg
          className="shell-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden="true"
        >
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case '/settings':
      return (
        <svg
          className="shell-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case '/admin':
      return (
        <svg
          className="shell-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden="true"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
    default:
      return (
        <svg
          className="shell-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
        </svg>
      );
  }
}

export function useResolvedPrimaryNav(): {
  readonly isAuthResolving: boolean;
  readonly links: readonly PrimaryNavLink[];
} {
  const { isAuthenticated, isLoading, user } = useAuth();
  const isAuthResolving = isLoading && !isAuthenticated;
  const { context } = useCapabilities();
  const admin = user != null && isAdmin(user.role);
  const devEnv: { readonly DEV?: boolean } = import.meta.env;
  const isDev = devEnv.DEV === true;

  const links = useMemo(() => {
    if (isAuthResolving) return [];
    const flags = deriveAppRouteFlags(context, { isDev });
    return getPrimaryNavLinks({
      authenticated: isAuthenticated,
      admin,
      developerToolsEnabled: flags.developerToolsEnabled,
      teamsEnabled: flags.teamsEnabled,
    });
  }, [isAuthResolving, isAuthenticated, admin, context, isDev]);

  return { isAuthResolving, links };
}

interface PrimaryNavMenuProps {
  readonly onNavigate?: (() => void) | undefined;
}

export const PrimaryNavMenu = ({ onNavigate }: PrimaryNavMenuProps): ReactElement => {
  const location = useLocation();
  const { t, translatePrimaryNav } = useChromeTranslation();
  const { isAuthResolving, links } = useResolvedPrimaryNav();

  return (
    <ScrollArea className="scroll-flex">
      <nav className="shell-primary-nav" aria-label="Primary">
        {isAuthResolving ? (
          <div className="shell-primary-nav__loading" aria-label={t('header.loadingNavigation')}>
            <Skeleton width="70%" height={18} radius={4} />
            <Skeleton width="82%" height={18} radius={4} />
            <Skeleton width="64%" height={18} radius={4} />
          </div>
        ) : (
          links.map((link) => {
            const hint = HINT_MAP[link.label];
            const isActive = isLinkActive(location.pathname, link.to);
            const displayLabel = translatePrimaryNav(link.to, link.label);
            const menuItem = (
              <Link
                key={link.label}
                to={link.to}
                className="shell-primary-nav__link"
                aria-current={isActive ? 'page' : undefined}
                onClick={onNavigate}
              >
                <MenuItem
                  className="shell-primary-nav__item"
                  data-selected={isActive ? 'true' : 'false'}
                >
                  <NavGlyph to={link.to} />
                  <Text as="span">{displayLabel}</Text>
                </MenuItem>
              </Link>
            );
            if (hint === undefined) return menuItem;
            return (
              <FeatureHint key={link.label} {...hint}>
                {menuItem}
              </FeatureHint>
            );
          })
        )}
      </nav>
    </ScrollArea>
  );
};

export const MobilePrimaryBar = (): ReactElement | null => {
  const location = useLocation();
  const { translatePrimaryNav } = useChromeTranslation();
  const { isAuthResolving, links } = useResolvedPrimaryNav();

  if (isAuthResolving || links.length === 0) {
    return null;
  }

  return (
    <BottombarLayout height="3.25rem" className="shell-mobile-bottombar">
      <nav aria-label="Mobile primary" className="shell-mobile-nav">
        {links.slice(0, 5).map((link) => {
          const isActive = isLinkActive(location.pathname, link.to);
          return (
            <Link
              key={link.label}
              to={link.to}
              className="shell-mobile-nav__link"
              aria-current={isActive ? 'page' : undefined}
            >
              {translatePrimaryNav(link.to, link.label)}
            </Link>
          );
        })}
      </nav>
    </BottombarLayout>
  );
};
