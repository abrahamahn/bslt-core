// main/apps/web/src/app/shells/ShellHeader.tsx
import { getUserDisplayName, isAdmin } from '@bslt/identity/contract';
import { openAuthModal, useAuth } from '@bslt/identity/web';
import { toastStore } from '@bslt/react';
import { Link, useLocation, useNavigate } from '@bslt/react/router';
import {
  Avatar,
  Button,
  Divider,
  Dropdown,
  Heading,
  Input,
  MenuItem,
  Skeleton,
  Text,
  TopbarLayout,
} from '@bslt/ui';
import { useCapabilities, type ShellName } from '@bslt/web-platform';
import { useCallback, useState, type ReactElement, type SyntheticEvent } from 'react';

import {
  OptionalHeaderNotifications,
  OptionalOrgSwitcher,
  useOptionalMyAvatar,
} from '../../generated/modules';

import { useResolvedPrimaryNav } from './PrimaryNavMenu';
import './Shells.css';

import { openAccountModal } from '#app/app/account';
import { getAccessToken } from '#app/app/authToken';
import { webApp } from '#app/app/webApp';
import { clientConfig } from '#app/config';
import { subscribeToKey } from '#app/lib/realtime';

interface ShellHeaderProps {
  readonly variant: ShellName;
  readonly navigationOpen?: boolean | undefined;
  readonly onToggleNavigation?: (() => void) | undefined;
  readonly alwaysShowNavToggle?: boolean | undefined;
}

const getInitials = (identifier: string): string => {
  const words = (identifier.split('@')[0] ?? identifier).split(/[\s._-]+/u).filter(Boolean);
  const first = words[0]?.charAt(0) ?? identifier.charAt(0);
  const last = words.length > 1 ? (words.at(-1)?.charAt(0) ?? '') : '';
  return `${first}${last}`.toUpperCase();
};

const getEmailFromToken = (): string | null => {
  const token = getAccessToken();
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }
  const payloadPart = token.split('.')[1];
  if (payloadPart === undefined || payloadPart.length === 0) {
    return null;
  }
  try {
    const base64 = payloadPart.replace(/-/gu, '+').replace(/_/gu, '/');
    if (typeof atob !== 'function') {
      return null;
    }
    const payload = JSON.parse(atob(base64)) as { email?: unknown };
    return typeof payload.email === 'string' && payload.email.trim().length > 0
      ? payload.email
      : null;
  } catch {
    return null;
  }
};

export const ShellHeader = ({
  variant,
  navigationOpen = false,
  onToggleNavigation,
  alwaysShowNavToggle = false,
}: ShellHeaderProps): ReactElement => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, isLoading: isAuthLoading, logout } = useAuth();
  const { isFlagEnabled } = useCapabilities();
  const { links: publicLinks } = useResolvedPrimaryNav();

  const teamsEnabled = isFlagEnabled('orgs.teams');
  const isAuthResolved = !isAuthLoading;
  const showSearch = user?.role !== undefined && isAdmin(user.role);

  const [searchTerm, setSearchTerm] = useState('');

  const myAvatar = useOptionalMyAvatar({
    enabled: isAuthenticated && isAuthResolved,
  });

  const handleSearchSubmit = useCallback(
    (event: SyntheticEvent): void => {
      event.preventDefault();
      const term = searchTerm.trim();
      if (term === '') return;
      navigate(`/search?q=${encodeURIComponent(term)}`);
    },
    [navigate, searchTerm],
  );

  const resolveNotificationRoute = useCallback(
    (data: Readonly<Record<string, unknown>> | null | undefined): string | null =>
      webApp.resolveNotificationRoute(data),
    [],
  );

  const handleNavigate = useCallback(
    (to: string): void => {
      navigate(to);
    },
    [navigate],
  );

  const handleLogout = useCallback((): void => {
    void logout().catch((error: unknown) => {
      toastStore.getState().show({
        title: 'Logout failed',
        description: error instanceof Error ? error.message : 'Unable to log out',
      });
    });
  }, [logout]);

  const tokenEmail = getEmailFromToken();
  const userIdentifier =
    [user !== null ? getUserDisplayName(user) : null, user?.email, tokenEmail, user?.id].find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    ) ?? 'Account';
  const avatarUrl = myAvatar.avatarUrl;
  const accountEmail = user?.email ?? tokenEmail;

  const leftSection = (
    <div className="shell-header__left">
      {onToggleNavigation !== undefined ? (
        <Button
          type="button"
          variant="secondary"
          size="small"
          onClick={onToggleNavigation}
          aria-label={navigationOpen ? 'Close navigation menu' : 'Open navigation menu'}
          className={
            alwaysShowNavToggle
              ? 'shell-header__nav-toggle shell-header__nav-toggle--always'
              : 'shell-header__nav-toggle'
          }
        >
          Menu
        </Button>
      ) : null}
      <Link to={isAuthenticated ? '/dashboard' : '/'} className="shell-header__brand-link">
        <Heading as="h1" size="lg" className="shell-header__title">
          {clientConfig.appName}
        </Heading>
      </Link>
    </div>
  );

  const centerSection =
    variant === 'public' ? (
      <nav aria-label="Primary" className="shell-header__public-nav">
        {publicLinks.map((link) => {
          const targetPath = link.to.split('?')[0] ?? link.to;
          const isActive =
            targetPath === '/'
              ? location.pathname === '/'
              : location.pathname === targetPath || location.pathname.startsWith(`${targetPath}/`);
          return (
            <Link
              key={link.label}
              to={link.to}
              className="shell-header__public-link"
              aria-current={isActive ? 'page' : undefined}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    ) : null;

  const rightSection = (
    <div className="shell-header__right">
      {isAuthLoading ? (
        <>
          <Skeleton width={120} height={16} radius={4} className="hide-mobile" />
          <Skeleton width={56} height={28} radius={6} />
        </>
      ) : isAuthenticated ? (
        <>
          {showSearch ? (
            <form
              onSubmit={handleSearchSubmit}
              role="search"
              className="hide-mobile shell-header__search"
              aria-label="Site search"
            >
              <Input
                type="search"
                value={searchTerm}
                placeholder="Search…"
                aria-label="Search"
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                }}
              />
              <Button type="submit" variant="secondary" size="small" aria-label="Submit search">
                Search
              </Button>
            </form>
          ) : null}
          {teamsEnabled ? <OptionalOrgSwitcher /> : null}
          <OptionalHeaderNotifications
            enabled={isAuthenticated}
            userId={user?.id}
            subscribeRealtime={subscribeToKey}
            onResolveRoute={resolveNotificationRoute}
            onNavigate={handleNavigate}
          />
          <Dropdown
            triggerAriaLabel="Account menu"
            trigger={
              <Avatar
                {...(avatarUrl !== null && avatarUrl !== ''
                  ? { src: avatarUrl }
                  : { 'data-initials': getInitials(userIdentifier) })}
                alt=""
                aria-hidden="true"
                className="shell-header__avatar"
              />
            }
          >
            {(close) => (
              <div className="shell-header__account-menu">
                <div className="shell-header__account-identity">
                  <Text as="span" className="shell-header__account-name">
                    {userIdentifier}
                  </Text>
                  {accountEmail !== null &&
                  accountEmail !== '' &&
                  accountEmail !== userIdentifier ? (
                    <Text as="span" size="sm" tone="muted">
                      {accountEmail}
                    </Text>
                  ) : null}
                </div>
                <Divider />
                <MenuItem
                  className="shell-header__account-item"
                  onClick={() => {
                    close();
                    openAccountModal('profile');
                  }}
                >
                  Profile
                </MenuItem>
                <MenuItem
                  className="shell-header__account-item"
                  onClick={() => {
                    close();
                    openAccountModal('security');
                  }}
                >
                  Settings
                </MenuItem>
                <Divider />
                <MenuItem
                  className="shell-header__account-item"
                  onClick={() => {
                    close();
                    handleLogout();
                  }}
                >
                  Log out
                </MenuItem>
              </div>
            )}
          </Dropdown>
        </>
      ) : (
        <>
          <Button
            type="button"
            variant="text"
            size="small"
            onClick={() => {
              openAuthModal('login');
            }}
          >
            Login
          </Button>
          <Button
            type="button"
            variant="primary"
            size="small"
            onClick={() => {
              openAuthModal('register');
            }}
          >
            Register
          </Button>
        </>
      )}
    </div>
  );

  return (
    <TopbarLayout
      height="3.5rem"
      data-testid="app-top-panel"
      left={leftSection}
      center={centerSection}
      right={rightSection}
    />
  );
};
