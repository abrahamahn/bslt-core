// main/apps/web/src/app/admin/AdminLayout.tsx
import { useAuth } from '@bslt/identity/web';
import { Navigate, Outlet, useLocation, useNavigate } from '@bslt/react/router';
import { Button, Heading, Text } from '@bslt/ui';
import { useAppRightSidebar, useCapabilities } from '@bslt/web-platform';
import { useMemo, type ReactElement, type ReactNode } from 'react';

import { hasAdminModule } from '../../generated/modules';

import { getAdminNavSurfaces, type AdminSurfaceId } from './adminSurface';

interface NavItem {
  id: AdminSurfaceId;
  label: string;
  path: string;
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
  const navItems = useMemo(
    () =>
      getAdminNavSurfaces({ advancedAdminEnabled }).map((surface) => ({
        id: surface.id,
        label: surface.label,
        path: surface.href,
      })),
    [advancedAdminEnabled],
  );

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
    <aside className="control-center-sidebar" aria-label="Admin control center">
      <div className="control-center-sidebar__header">
        <Heading as="h2" size="md">
          Admin
        </Heading>
        <Text size="xs" tone="muted">
          Control Center
        </Text>
      </div>
      <nav className="control-center-sidebar__nav" aria-label="Admin sections">
        {navItems.map((item) => (
          <NavButton
            key={item.path}
            item={item}
            isActive={isNavItemActive(item)}
            onClick={() => {
              navigate(item.path);
            }}
          />
        ))}
      </nav>
    </aside>
  );
};

export const AdminLayout = ({ children }: AdminLayoutProps): ReactElement => {
  const authResult = useAuth();
  const user = authResult.user as { role?: string } | null | undefined;
  const { isLoading, isAuthenticated } = authResult;
  const location = useLocation();
  const { isFlagEnabled } = useCapabilities();
  const advancedAdminEnabled = isFlagEnabled('flags.advanced_admin');
  const adminSidebar = useMemo(
    () => <AdminSidebar advancedAdminEnabled={advancedAdminEnabled} />,
    [advancedAdminEnabled],
  );
  useAppRightSidebar(isAuthenticated && user?.role === 'admin' ? adminSidebar : null);

  if (isLoading && !isAuthenticated) {
    return (
      <main className="flex h-screen items-center justify-center">
        <Text tone="muted">Loading admin access. Sign in may be required.</Text>
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
            Access denied
          </Heading>
          <Text tone="muted" className="mb-4">
            Forbidden. Your account is not authorized to access admin tools.
          </Text>
          <Button
            type="button"
            onClick={() => {
              window.location.href = '/dashboard';
            }}
          >
            Back to Dashboard
          </Button>
        </div>
      </main>
    );
  }

  return <div data-testid="admin-layout-content">{children ?? <Outlet />}</div>;
};
