// main/apps/web/src/app/shells/AppShell.tsx
import { NewDeviceBanner, useAuth } from '@bslt/identity/web';
import { useIsMobile } from '@bslt/react/hooks';
import { Outlet } from '@bslt/react/router';
import { LeftSidebarLayout, ScrollArea, Text } from '@bslt/ui';
import { useCapabilities } from '@bslt/web-platform';
import { useCallback, useState, type ReactElement, type ReactNode } from 'react';

import {
  hasOrgsModule,
  OptionalImpersonationBanner,
  OptionalOrgSwitcher,
} from '../../generated/modules';

import { MobilePrimaryBar, PrimaryNavMenu } from './PrimaryNavMenu';
import { ShellHeader } from './ShellHeader';
import { SiteFooter } from './SiteFooter';
import './Shells.css';

interface AppShellProps {
  readonly children?: ReactNode;
}

export const AppShell = ({ children }: AppShellProps): ReactElement => {
  const isMobile = useIsMobile();
  const { isAuthenticated } = useAuth();
  const { isFlagEnabled } = useCapabilities();
  const showSidebarWorkspace = isAuthenticated && hasOrgsModule && isFlagEnabled('orgs.teams');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const toggleMobileNav = useCallback((): void => {
    setMobileNavOpen((open) => !open);
  }, []);

  const closeMobileNav = useCallback((): void => {
    setMobileNavOpen(false);
  }, []);

  return (
    <div className="shell-app" data-shell="app">
      <ShellHeader
        variant="app"
        navigationOpen={mobileNavOpen}
        onToggleNavigation={toggleMobileNav}
      />
      <NewDeviceBanner />
      <OptionalImpersonationBanner />
      <div className="shell-app__body">
        <LeftSidebarLayout
          width="14.5rem"
          className="shell-app__sidebar"
          data-open={mobileNavOpen ? 'true' : 'false'}
        >
          {showSidebarWorkspace ? (
            <div className="shell-app__workspace-bar">
              <Text as="span" size="xs" tone="muted" className="shell-app__workspace-label">
                Active Workspace
              </Text>
              <OptionalOrgSwitcher />
            </div>
          ) : null}
          <PrimaryNavMenu onNavigate={closeMobileNav} />
        </LeftSidebarLayout>
        <main id="main-content" className="shell-app__main">
          <ScrollArea className="h-full w-full">
            <div className="shell-app__content">{children ?? <Outlet />}</div>
            <SiteFooter />
          </ScrollArea>
        </main>
      </div>
      {isMobile ? <MobilePrimaryBar /> : null}
    </div>
  );
};
