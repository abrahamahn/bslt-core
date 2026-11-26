// main/apps/web/src/app/account/SettingsLayout.tsx
import { Outlet, useLocation, useNavigate } from '@bslt/react/router';
import { Button, Heading, Text } from '@bslt/ui';
import { useCapabilities } from '@bslt/web-platform';
import { useCallback, useMemo, type ReactElement, type ReactNode } from 'react';

import { hasOrgsModule } from '../../generated/modules';

import { getActiveSettingsTab, getSettingsNavItems, type SettingsNavItem } from './settingsTabs';

import './SettingsPage.css';

import { useChromeTranslation } from '#app/i18n/chromeLabels';

const WORKSPACE_TAB_IDS = new Set(['billing', 'entitlements']);

interface SettingsLayoutProps {
  readonly activeSection?: string;
  readonly children?: ReactNode;
  readonly description?: string | undefined;
}

export const SettingsLayout = ({
  activeSection,
  children,
  description,
}: SettingsLayoutProps): ReactElement => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, translateSettingsSection } = useChromeTranslation();
  const { isFlagEnabled } = useCapabilities();
  const billingEnabled = isFlagEnabled('flags.billing');
  const teamsEnabled = isFlagEnabled('orgs.teams');

  const navItems = useMemo(() => getSettingsNavItems({ billingEnabled }), [billingEnabled]);
  const personalItems = useMemo(
    () => navItems.filter((item) => !WORKSPACE_TAB_IDS.has(item.id)),
    [navItems],
  );
  const workspaceItems = useMemo(
    () => navItems.filter((item) => WORKSPACE_TAB_IDS.has(item.id)),
    [navItems],
  );
  const resolvedSection = useMemo(
    () => activeSection ?? getActiveSettingsTab(location),
    [activeSection, location],
  );
  const activeItem = navItems.find((item) => item.id === resolvedSection);
  const activeLabel =
    activeItem !== undefined
      ? translateSettingsSection(activeItem.id, activeItem.label)
      : t('settings.title');

  const handleSelect = useCallback(
    (item: SettingsNavItem): void => {
      if (item.kind === 'route' && item.to !== undefined) {
        if (item.id === 'billing' && !billingEnabled) return;
        navigate(item.to);
        return;
      }
      navigate(`/settings/${encodeURIComponent(item.id)}`);
    },
    [billingEnabled, navigate],
  );

  const isRouteOutlet = children === undefined;

  return (
    <div className="settings-layout settings-page" data-testid="settings-layout">
      <aside className="settings-layout__sidebar" aria-label={t('settings.aria.controlCenter')}>
        <div className="settings-layout__sidebar-header">
          <Heading as="h2" size="md">
            {t('settings.title')}
          </Heading>
          <Text size="xs" tone="muted">
            {t('settings.subtitle')}
          </Text>
        </div>
        <nav className="settings-layout__nav" aria-label={t('settings.aria.sections')}>
          <div className="settings-layout__group">
            <Text as="span" size="xs" tone="muted" className="settings-layout__group-label">
              {t('settings.group.personal')}
            </Text>
            {personalItems.map((item) => {
              const isActive = item.id === resolvedSection;
              return (
                <Button
                  key={item.id}
                  type="button"
                  variant={isActive ? 'secondary' : 'text'}
                  className="settings-layout__nav-button"
                  aria-current={isActive ? 'page' : undefined}
                  data-active={isActive ? 'true' : 'false'}
                  onClick={() => {
                    handleSelect(item);
                  }}
                >
                  {translateSettingsSection(item.id, item.label)}
                </Button>
              );
            })}
          </div>
          {workspaceItems.length > 0 || (hasOrgsModule && teamsEnabled) ? (
            <div className="settings-layout__group">
              <Text as="span" size="xs" tone="muted" className="settings-layout__group-label">
                {t('settings.group.workspace')}
              </Text>
              {hasOrgsModule && teamsEnabled ? (
                <Button
                  type="button"
                  variant="text"
                  className="settings-layout__nav-button"
                  data-active="false"
                  onClick={() => {
                    navigate('/organization');
                  }}
                >
                  {t('nav.workspaceConsole')}
                </Button>
              ) : null}
              {workspaceItems.map((item) => {
                const isActive = item.id === resolvedSection;
                return (
                  <Button
                    key={item.id}
                    type="button"
                    variant={isActive ? 'secondary' : 'text'}
                    className="settings-layout__nav-button"
                    aria-current={isActive ? 'page' : undefined}
                    data-active={isActive ? 'true' : 'false'}
                    onClick={() => {
                      handleSelect(item);
                    }}
                  >
                    {translateSettingsSection(item.id, item.label)}
                  </Button>
                );
              })}
            </div>
          ) : null}
        </nav>
      </aside>
      <div className="settings-layout__main">
        {isRouteOutlet ? (
          <div
            id={`settings-panel-${resolvedSection}`}
            role="tabpanel"
            data-active-tab={resolvedSection}
            aria-label={`${activeLabel} settings`}
          >
            <Outlet />
          </div>
        ) : (
          <div
            id={`settings-panel-${resolvedSection}`}
            className="settings-page__content-panel"
            role="tabpanel"
            data-active-tab={resolvedSection}
            aria-label={`${activeLabel} settings`}
          >
            <header className="settings-layout__panel-header">
              <Heading as="h1" size="xl">
                {activeLabel}
              </Heading>
              {description !== undefined ? (
                <Text tone="muted" size="sm" className="settings-section__description">
                  {description}
                </Text>
              ) : null}
            </header>
            {children}
          </div>
        )}
      </div>
    </div>
  );
};
