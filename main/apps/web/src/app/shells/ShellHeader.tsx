// main/apps/web/src/app/shells/ShellHeader.tsx
import { getUserDisplayName } from '@bslt/identity/contract';
import { openAuthModal, useAuth } from '@bslt/identity/web';
import { toastStore } from '@bslt/react';
import { Link, useLocation, useNavigate } from '@bslt/react/router';
import {
  Avatar,
  Button,
  Divider,
  Dropdown,
  Input,
  Kbd,
  MenuItem,
  Skeleton,
  Text,
  TopbarLayout,
} from '@bslt/ui';
import { useCapabilities, type ShellName } from '@bslt/web-platform';
import { useCallback, useState, type ReactElement, type SyntheticEvent } from 'react';

import {
  hasSearchModule,
  OptionalHeaderNotifications,
  OptionalOrgSwitcher,
  useOptionalMyAvatar,
} from '../../generated/modules';
import { useOptionalClientEnvironment } from '../ClientEnvironment';
import { openCommandPalette } from '../command-palette';

import { useResolvedPrimaryNav } from './PrimaryNavMenu';
import './Shells.css';

import { getAccessToken } from '#app/app/authToken';
import { webApp } from '#app/app/webApp';
import { clientConfig } from '#app/config';
import { useChromeTranslation } from '#app/i18n/chromeLabels';
import { applyLocalePreference } from '#app/i18n/persistLocale';
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
  const environment = useOptionalClientEnvironment();
  const { locale, setLocale, t, translatePrimaryNav } = useChromeTranslation();
  const { user, isAuthenticated, isLoading: isAuthLoading, logout } = useAuth();
  const { isFlagEnabled } = useCapabilities();
  const { links: publicLinks } = useResolvedPrimaryNav();

  const teamsEnabled = isFlagEnabled('orgs.teams');
  const isAuthResolved = !isAuthLoading;
  const showSearch = hasSearchModule;

  const [searchTerm, setSearchTerm] = useState('');

  const handleToggleLocale = useCallback((): void => {
    if (setLocale === undefined) return;
    const nextLocale = locale === 'ko-KR' ? 'en-US' : 'ko-KR';
    applyLocalePreference(nextLocale, { setLocale, environment });
  }, [environment, locale, setLocale]);

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
        title: t('header.logoutFailed'),
        description: error instanceof Error ? error.message : t('header.logoutFailedFallback'),
      });
    });
  }, [logout, t]);

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
          aria-label={navigationOpen ? t('header.closeNav') : t('header.openNav')}
          className={
            alwaysShowNavToggle
              ? 'shell-header__nav-toggle shell-header__nav-toggle--always'
              : 'shell-header__nav-toggle'
          }
        >
          {t('header.menu')}
        </Button>
      ) : null}
      <Link to={isAuthenticated ? '/dashboard' : '/'} className="shell-header__brand-link">
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
              {translatePrimaryNav(link.to, link.label)}
            </Link>
          );
        })}
      </nav>
    ) : variant === 'auth' ? (
      <nav aria-label={t('nav.docs')} className="shell-header__public-nav">
        <Link to="/docs" className="shell-header__public-link">
          {t('nav.docs')}
        </Link>
        <Link to="/pricing" className="shell-header__public-link">
          {t('nav.pricing')}
        </Link>
      </nav>
    ) : null;

  const localeToggle =
    setLocale !== undefined ? (
      <Button
        type="button"
        variant="text"
        size="small"
        className="shell-header__locale-toggle"
        data-testid="header-locale-toggle"
        aria-label={t('header.switchLanguage')}
        onClick={handleToggleLocale}
      >
        {locale === 'ko-KR' ? 'EN' : '한국어'}
      </Button>
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
          <Button
            type="button"
            variant="secondary"
            size="small"
            className="hide-mobile shell-header__cmd-trigger"
            title={t('header.jumpToTitle')}
            onClick={openCommandPalette}
          >
            <span className="shell-header__cmd-label">{t('header.jumpTo')}</span>
            <Kbd aria-hidden="true">⌘K</Kbd>
          </Button>
          {showSearch ? (
            <form
              onSubmit={handleSearchSubmit}
              role="search"
              className="hide-mobile shell-header__search"
              aria-label={t('header.siteSearch')}
            >
              <Input
                type="search"
                value={searchTerm}
                placeholder={t('header.searchPlaceholder')}
                aria-label={t('header.search')}
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                }}
              />
              <Button
                type="submit"
                variant="secondary"
                size="small"
                aria-label={t('header.submitSearch')}
              >
                {t('header.search')}
              </Button>
            </form>
          ) : null}
          {teamsEnabled ? <OptionalOrgSwitcher /> : null}
          {localeToggle}
          <OptionalHeaderNotifications
            enabled={isAuthenticated}
            userId={user?.id}
            subscribeRealtime={subscribeToKey}
            onResolveRoute={resolveNotificationRoute}
            onNavigate={handleNavigate}
          />
          <Dropdown
            triggerAriaLabel={t('header.accountMenu')}
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
                    navigate('/profile');
                  }}
                >
                  {t('header.profile')}
                </MenuItem>
                <MenuItem
                  className="shell-header__account-item"
                  onClick={() => {
                    close();
                    navigate('/settings/security');
                  }}
                >
                  {t('header.settings')}
                </MenuItem>
                <MenuItem
                  className="shell-header__account-item"
                  onClick={() => {
                    close();
                    navigate('/settings/preferences');
                  }}
                >
                  {t('header.preferences')}
                </MenuItem>
                <Divider />
                <MenuItem
                  className="shell-header__account-item"
                  onClick={() => {
                    close();
                    handleLogout();
                  }}
                >
                  {t('header.logout')}
                </MenuItem>
              </div>
            )}
          </Dropdown>
        </>
      ) : (
        <>
          {localeToggle}
          <Button
            type="button"
            variant="text"
            size="small"
            onClick={() => {
              openAuthModal('login');
            }}
          >
            {t('header.login')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="small"
            onClick={() => {
              openAuthModal('register');
            }}
          >
            {t('header.register')}
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
