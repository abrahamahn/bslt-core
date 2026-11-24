// main/apps/web/src/app/workspace/WorkspaceLayout.tsx
import { Outlet, useLocation, useNavigate } from '@bslt/react/router';
import { Button, Heading, Text } from '@bslt/ui';
import { useCapabilities } from '@bslt/web-platform';
import { useCallback, useMemo, type ReactElement } from 'react';

import { hasBillingModule, installedModules, OptionalOrgSwitcher } from '../../generated/modules';

import '../account/SettingsPage.css';

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

const GROUP_LABELS: Readonly<Record<WorkspaceNavItem['group'], string>> = {
  team: 'Team & Access',
  plan: 'Plan & Usage',
  developers: 'Developers',
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
  const { isFlagEnabled } = useCapabilities();
  const billingEnabled = isFlagEnabled('flags.billing');

  const navItems = useMemo((): readonly WorkspaceNavItem[] => {
    const items: WorkspaceNavItem[] = [
      { id: 'general', label: 'Team & Settings', to: '/organization', group: 'team' },
    ];
    if (hasBillingModule && billingEnabled) {
      items.push({
        id: 'billing',
        label: 'Billing & Invoices',
        to: '/workspace/billing',
        group: 'plan',
      });
    }
    if (hasEntitlementsModule) {
      items.push({
        id: 'entitlements',
        label: 'Plan & Entitlements',
        to: '/workspace/entitlements',
        group: 'plan',
      });
    }
    if (hasWebhooksModule) {
      items.push({
        id: 'webhooks',
        label: 'Webhooks',
        to: '/workspace/webhooks',
        group: 'developers',
      });
    }
    if (hasAuditModule) {
      items.push({
        id: 'audit',
        label: 'Audit & Activity',
        to: '/workspace/audit',
        group: 'developers',
      });
    }
    return items;
  }, [billingEnabled]);

  const activeId = resolveActiveWorkspaceId(location.pathname);
  const activeLabel = navItems.find((item) => item.id === activeId)?.label ?? 'Workspace';

  const handleSelect = useCallback(
    (to: string): void => {
      navigate(to);
    },
    [navigate],
  );

  return (
    <div className="settings-layout settings-page" data-testid="workspace-layout">
      <aside className="settings-layout__sidebar" aria-label="Workspace control center">
        <div className="settings-layout__sidebar-header">
          <Heading as="h2" size="md">
            Workspace
          </Heading>
          <Text size="xs" tone="muted">
            Team, Plan & Developers
          </Text>
          <div className="settings-layout__switcher">
            <OptionalOrgSwitcher />
          </div>
        </div>
        <nav className="settings-layout__nav" aria-label="Workspace sections">
          {GROUP_ORDER.map((group) => {
            const groupItems = navItems.filter((item) => item.group === group);
            if (groupItems.length === 0) return null;
            return (
              <div key={group} className="settings-layout__group">
                <Text as="span" size="xs" tone="muted" className="settings-layout__group-label">
                  {GROUP_LABELS[group]}
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
          aria-label={`${activeLabel} workspace panel`}
        >
          <Outlet />
        </div>
      </div>
    </div>
  );
};
