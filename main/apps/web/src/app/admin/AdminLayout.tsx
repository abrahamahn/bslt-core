// main/apps/web/src/app/admin/AdminLayout.tsx
import { useAuth } from '@bslt/identity/web';
import { Navigate, Outlet, useLocation, useNavigate } from '@bslt/react/router';
import { Button, Heading, Text } from '@bslt/ui';
import { useCapabilities } from '@bslt/web-platform';
import { useMemo, type ReactElement, type ReactNode } from 'react';

import { hasAdminModule } from '../../generated/modules';

import { getAdminNavSurfaces, type AdminSurfaceId } from './adminSurface';

import { useChromeTranslation } from '#app/i18n/chromeLabels';

interface NavItem {
  id: AdminSurfaceId;
  label: string;
  path: string;
}

interface AdminNavGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly NavItem[];
}

const ADMIN_GROUP_ORDER: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly surfaceIds: readonly string[];
}> = [
  {
    id: 'operations',
    label: 'Operations',
    surfaceIds: ['dashboard', 'health', 'jobs', 'feature-flags'],
  },
  {
    id: 'directory',
    label: 'Users & Orgs',
    surfaceIds: ['users', 'tenants', 'notifications'],
  },
  {
    id: 'trust',
    label: 'Trust & Compliance',
    surfaceIds: ['security', 'audit', 'moderation', 'support', 'legal', 'compliance'],
  },
  {
    id: 'platform',
    label: 'Billing & Webhooks',
    surfaceIds: ['billing', 'entitlements', 'webhooks', 'webhook-endpoints'],
  },
];

function groupAdminNavItems(items: readonly NavItem[]): AdminNavGroup[] {
  const assigned = new Set<string>();
  const groups: AdminNavGroup[] = [];

  for (const spec of ADMIN_GROUP_ORDER) {
    const memberSet = new Set(spec.surfaceIds);
    const matched = items.filter((item) => memberSet.has(item.id));
    if (matched.length > 0) {
      for (const item of matched) assigned.add(item.id);
      groups.push({ id: spec.id, label: spec.label, items: matched });
    }
  }

  const remaining = items.filter((item) => !assigned.has(item.id));
  if (remaining.length > 0) {
    groups.push({ id: 'modules', label: 'Modules', items: remaining });
  }

  return groups;
}

interface AdminLayoutProps {
  children?: ReactNode;
}

interface AdminSidebarProps {
  advancedAdminEnabled: boolean;
}

const NavButton = ({
  item,
  isActive,
  onClick,
}: {
  item: NavItem;
  isActive: boolean;
  onClick: () => void;
}): ReactElement => {
  return (
    <Button
      type="button"
      variant={isActive ? 'secondary' : 'text'}
      size="small"
      className="control-center-sidebar__button"
      aria-current={isActive ? 'page' : undefined}
      data-active={isActive ? 'true' : 'false'}
      onClick={onClick}
    >
      {item.label}
    </Button>
  );
};

const AdminSidebar = ({ advancedAdminEnabled }: AdminSidebarProps): ReactElement => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, translateAdminSurface } = useChromeTranslation();
  const navGroups = useMemo(() => {
    const navItems: NavItem[] = getAdminNavSurfaces({ advancedAdminEnabled }).map((surface) => ({
      id: surface.id,
      label: translateAdminSurface(surface.id, surface.label),
      path: surface.href,
    }));
    return groupAdminNavItems(navItems).map((group) => ({
      ...group,
      label: t(`admin.group.${group.id}`),
    }));
  }, [advancedAdminEnabled, t, translateAdminSurface]);

  const isNavItemActive = (item: NavItem): boolean => {
    if (
      (item.id === 'health' || (!hasAdminModule && item.id === 'dashboard')) &&
      location.pathname === '/admin'
    ) {
      return true;
    }
    return location.pathname.startsWith(item.path);
  };

  return (
    <aside className="control-center-sidebar" aria-label={t('admin.aria.controlCenter')}>
      <div className="control-center-sidebar__header">
        <Heading as="h2" size="md">
          {t('admin.title')}
        </Heading>
        <Text size="xs" tone="muted">
          {t('admin.subtitle')}
        </Text>
      </div>
      <nav className="control-center-sidebar__nav" aria-label={t('admin.aria.sections')}>
        {navGroups.map((group) => (
          <div key={group.id} className="control-center-sidebar__group">
            <Text as="span" size="xs" tone="muted" className="control-center-sidebar__group-label">
              {group.label}
            </Text>
            <div className="control-center-sidebar__group-items">
              {group.items.map((item) => (
                <NavButton
                  key={item.path}
                  item={item}
                  isActive={isNavItemActive(item)}
                  onClick={() => {
                    navigate(item.path);
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
};

export const AdminLayout = ({ children }: AdminLayoutProps): ReactElement => {
  const { t } = useChromeTranslation();
  const authResult = useAuth();
  const user = authResult.user as { role?: string } | null | undefined;
  const { isLoading, isAuthenticated } = authResult;
  const location = useLocation();
  const { isFlagEnabled } = useCapabilities();
  const advancedAdminEnabled = isFlagEnabled('flags.advanced_admin');

  if (isLoading && !isAuthenticated) {
    return (
      <main className="flex h-screen items-center justify-center">
        <Text tone="muted">{t('admin.loading')}</Text>
      </main>
    );
  }

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  if (user?.role !== 'admin') {
    return (
      <main className="flex min-h-full items-center justify-center p-6">
        <div className="max-w-md text-center">
          <Heading as="h1" size="lg" className="mb-3">
            {t('admin.accessDenied')}
          </Heading>
          <Text tone="muted" className="mb-4">
            {t('admin.accessDeniedBody')}
          </Text>
          <Button
            type="button"
            onClick={() => {
              window.location.href = '/dashboard';
            }}
          >
            {t('admin.backToDashboard')}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <div className="admin-layout">
      <AdminSidebar advancedAdminEnabled={advancedAdminEnabled} />
      <div className="admin-layout__main" data-testid="admin-layout-content">
        {children ?? <Outlet />}
      </div>
    </div>
  );
};
