// main/apps/web/src/app/workspace/WorkspaceLayout.tsx
import { Outlet, useLocation, useNavigate } from '@bslt/react/router';
import { Button, Heading, Text } from '@bslt/ui';
import { useCapabilities } from '@bslt/web-platform';
import { useCallback, useMemo, type ReactElement } from 'react';

import { hasBillingModule, installedModules, OptionalOrgSwitcher } from '../../generated/modules';

import '../account/SettingsPage.css';

import { useChromeTranslation } from '#app/i18n/chromeLabels';

interface WorkspaceNavItem {
  readonly id: string;
  readonly label: string;
  readonly to: string;
  readonly group: 'team' | 'plan' | 'developers';
}

const installedIds = new Set<string>(installedModules.map((mod) => mod.id));
const hasAuditModule = installedIds.has('audit');
const hasEntitlementsModule = installedIds.has('entitlements');
const hasWebhooksModule = installedIds.has('webhooks');

const GROUP_LABEL_KEYS: Readonly<Record<WorkspaceNavItem['group'], string>> = {
  team: 'workspace.group.team',
  plan: 'workspace.group.plan',
  developers: 'workspace.group.developers',
};

const GROUP_ORDER: readonly WorkspaceNavItem['group'][] = ['team', 'plan', 'developers'];

function resolveActiveWorkspaceId(pathname: string): string {
  if (pathname.startsWith('/workspace/billing')) return 'billing';
  if (pathname.startsWith('/workspace/entitlements')) return 'entitlements';
  if (pathname.startsWith('/workspace/webhooks')) return 'webhooks';
  if (pathname.startsWith('/workspace/audit')) return 'audit';
  return 'general';
}

export const WorkspaceLayout = (): ReactElement => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useChromeTranslation();
  const { isFlagEnabled } = useCapabilities();
  const billingEnabled = isFlagEnabled('flags.billing');

  const navItems = useMemo((): readonly WorkspaceNavItem[] => {
    const items: WorkspaceNavItem[] = [
      { id: 'general', label: t('workspace.nav.general'), to: '/organization', group: 'team' },
    ];
    if (hasBillingModule && billingEnabled) {
      items.push({
        id: 'billing',
        label: t('workspace.nav.billing'),
        to: '/workspace/billing',
        group: 'plan',
      });
    }
    if (hasEntitlementsModule) {
      items.push({
        id: 'entitlements',
        label: t('workspace.nav.entitlements'),
        to: '/workspace/entitlements',
        group: 'plan',
      });
    }
    if (hasWebhooksModule) {
      items.push({
        id: 'webhooks',
        label: t('workspace.nav.webhooks'),
        to: '/workspace/webhooks',
        group: 'developers',
      });
    }
    if (hasAuditModule) {
      items.push({
        id: 'audit',
        label: t('workspace.nav.audit'),
        to: '/workspace/audit',
        group: 'developers',
      });
    }
    return items;
  }, [billingEnabled, t]);

  const activeId = resolveActiveWorkspaceId(location.pathname);
  const activeLabel = navItems.find((item) => item.id === activeId)?.label ?? t('workspace.title');

  const handleSelect = useCallback(
    (to: string): void => {
      navigate(to);
    },
    [navigate],
  );

  return (
    <div className="settings-layout settings-page" data-testid="workspace-layout">
      <aside className="settings-layout__sidebar" aria-label={t('workspace.aria.controlCenter')}>
        <div className="settings-layout__sidebar-header">
          <Heading as="h2" size="md">
            {t('workspace.title')}
          </Heading>
          <Text size="xs" tone="muted">
            {t('workspace.subtitle')}
          </Text>
          <div className="settings-layout__switcher">
            <OptionalOrgSwitcher />
          </div>
        </div>
        <nav className="settings-layout__nav" aria-label={t('workspace.aria.sections')}>
          {GROUP_ORDER.map((group) => {
            const groupItems = navItems.filter((item) => item.group === group);
            if (groupItems.length === 0) return null;
            return (
              <div key={group} className="settings-layout__group">
                <Text as="span" size="xs" tone="muted" className="settings-layout__group-label">
                  {t(GROUP_LABEL_KEYS[group])}
                </Text>
                {groupItems.map((item) => {
                  const isActive = item.id === activeId;
                  return (
                    <Button
                      key={item.id}
                      type="button"
                      variant={isActive ? 'secondary' : 'text'}
                      className="settings-layout__nav-button"
                      aria-current={isActive ? 'page' : undefined}
                      data-active={isActive ? 'true' : 'false'}
                      onClick={() => {
                        handleSelect(item.to);
                      }}
                    >
                      {item.label}
                    </Button>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="settings-layout__main">
        <div
          id={`workspace-panel-${activeId}`}
          role="region"
          data-active-tab={activeId}
          aria-label={t('workspace.aria.panel', { label: activeLabel })}
        >
          <Outlet />
        </div>
      </div>
    </div>
  );
};
