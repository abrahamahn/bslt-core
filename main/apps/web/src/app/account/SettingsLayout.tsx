// main/apps/web/src/app/account/SettingsLayout.tsx
import { Outlet, useLocation, useNavigate } from '@bslt/react/router';
import { Button, Heading, Text } from '@bslt/ui';
import { useCapabilities } from '@bslt/web-platform';
import { useCallback, useMemo, type ReactElement, type ReactNode } from 'react';

import { getActiveSettingsTab, getSettingsNavItems, type SettingsNavItem } from './settingsTabs';

import './SettingsPage.css';

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
  const { isFlagEnabled } = useCapabilities();
  const billingEnabled = isFlagEnabled('flags.billing');

  const navItems = useMemo(() => getSettingsNavItems({ billingEnabled }), [billingEnabled]);
  const resolvedSection = useMemo(
    () => activeSection ?? getActiveSettingsTab(location),
    [activeSection, location],
  );
  const activeLabel = navItems.find((item) => item.id === resolvedSection)?.label ?? 'Settings';

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
      <aside className="settings-layout__sidebar" aria-label="Settings control center">
        <div className="settings-layout__sidebar-header">
          <Heading as="h2" size="md">
            Settings
          </Heading>
          <Text size="xs" tone="muted">
            Account & Preferences
          </Text>
        </div>
        <nav className="settings-layout__nav" aria-label="Settings sections">
          {navItems.map((item) => {
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
                {item.label}
              </Button>
            );
          })}
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
