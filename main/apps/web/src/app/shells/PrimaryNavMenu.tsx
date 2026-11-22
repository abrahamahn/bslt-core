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
  return pathname === targetPath || pathname.startsWith(`${targetPath}/`);
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
    });
  }, [isAuthResolving, isAuthenticated, admin, context, isDev]);

  return { isAuthResolving, links };
}

interface PrimaryNavMenuProps {
  readonly onNavigate?: (() => void) | undefined;
}

export const PrimaryNavMenu = ({ onNavigate }: PrimaryNavMenuProps): ReactElement => {
  const location = useLocation();
  const { isAuthResolving, links } = useResolvedPrimaryNav();

  return (
    <ScrollArea className="scroll-flex">
      <nav className="shell-primary-nav" aria-label="Primary">
        {isAuthResolving ? (
          <div className="shell-primary-nav__loading" aria-label="Loading navigation">
            <Skeleton width="70%" height={18} radius={4} />
            <Skeleton width="82%" height={18} radius={4} />
            <Skeleton width="64%" height={18} radius={4} />
          </div>
        ) : (
          links.map((link) => {
            const hint = HINT_MAP[link.label];
            const isActive = isLinkActive(location.pathname, link.to);
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
                  <Text>{link.label}</Text>
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
              {link.label}
            </Link>
          );
        })}
      </nav>
    </BottombarLayout>
  );
};
