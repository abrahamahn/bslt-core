// main/apps/web/src/app/shells/ConsoleShell.tsx
import { NewDeviceBanner } from '@bslt/identity/web';
import { Outlet } from '@bslt/react/router';
import { ResizablePanel, ResizablePanelGroup, ScrollArea } from '@bslt/ui';
import { AppLayoutContext } from '@bslt/web-platform';
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { OptionalImpersonationBanner } from '../../generated/modules';

import { PrimaryNavMenu } from './PrimaryNavMenu';
import { ShellHeader } from './ShellHeader';
import './Shells.css';

interface ConsoleShellProps {
  readonly children?: ReactNode;
}

export const ConsoleShell = ({ children }: ConsoleShellProps): ReactElement => {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightSidebar, setRightSidebarState] = useState<ReactNode | null>(null);

  const toggleLeftPane = useCallback((): void => {
    setLeftOpen((open) => !open);
  }, []);

  const setRightSidebar = useCallback((content: ReactNode | null): void => {
    setRightSidebarState(content);
  }, []);

  const contextValue = useMemo(() => ({ setRightSidebar }), [setRightSidebar]);

  return (
    <div className="shell-console" data-shell="console">
      <ShellHeader
        variant="console"
        navigationOpen={leftOpen}
        onToggleNavigation={toggleLeftPane}
        alwaysShowNavToggle
      />
      <NewDeviceBanner />
      <OptionalImpersonationBanner />
      <AppLayoutContext.Provider value={contextValue}>
        <div className="shell-console__body">
          <ResizablePanelGroup direction="horizontal" className="flex-1 min-w-0 h-full">
            <ResizablePanel
              defaultSize={18}
              minSize={12}
              maxSize={30}
              collapsed={!leftOpen}
              className="shell-console__pane shell-console__pane--left"
            >
              <PrimaryNavMenu />
            </ResizablePanel>
            <main id="main-content" className="shell-console__main">
              <ScrollArea className="h-full w-full">
                <div className="shell-console__content">{children ?? <Outlet />}</div>
              </ScrollArea>
            </main>
            {rightSidebar !== null ? (
              <ResizablePanel
                defaultSize={24}
                minSize={14}
                maxSize={45}
                invertResize
                className="shell-console__pane shell-console__pane--right"
              >
                {rightSidebar}
              </ResizablePanel>
            ) : null}
          </ResizablePanelGroup>
        </div>
      </AppLayoutContext.Provider>
    </div>
  );
};
