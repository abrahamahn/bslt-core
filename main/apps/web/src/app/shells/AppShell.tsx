// main/apps/web/src/app/shells/AppShell.tsx
import { NewDeviceBanner } from '@bslt/identity/web';
import { useIsMobile } from '@bslt/react/hooks';
import { Outlet } from '@bslt/react/router';
import { LeftSidebarLayout, ScrollArea } from '@bslt/ui';
import { useCallback, useState, type ReactElement, type ReactNode } from 'react';

import { OptionalImpersonationBanner } from '../../generated/modules';

import { MobilePrimaryBar, PrimaryNavMenu } from './PrimaryNavMenu';
import { ShellHeader } from './ShellHeader';
import { SiteFooter } from './SiteFooter';
import './Shells.css';

interface AppShellProps {
  readonly children?: ReactNode;
}

export const AppShell = ({ children }: AppShellProps): ReactElement => {
  const isMobile = useIsMobile();
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
