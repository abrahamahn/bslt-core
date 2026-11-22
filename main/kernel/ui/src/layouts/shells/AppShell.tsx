// main/kernel/ui/src/layouts/shells/AppShell.tsx
import { cn } from '../../utils/cn';

import { ResizablePanel, ResizablePanelGroup } from './ResizablePanel';

import '../../styles/layouts.css';
import type { CSSProperties, ReactElement, ReactNode, Ref } from 'react';

export type AppShellProps = {
  header?: ReactNode;
  sidebar?: ReactNode;
  aside?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  headerHeight?: string | number;
  footerHeight?: string | number;
  sidebarWidth?: string | number;
  asideWidth?: string | number;
  headerCollapsed?: boolean;
  sidebarCollapsed?: boolean;
  asideCollapsed?: boolean;
  footerCollapsed?: boolean;
  headerResizable?: boolean;
  sidebarResizable?: boolean;
  asideResizable?: boolean;
  footerResizable?: boolean;
  headerMinSize?: number;
  headerMaxSize?: number;
  sidebarMinSize?: number;
  sidebarMaxSize?: number;
  asideMinSize?: number;
  asideMaxSize?: number;
  footerMinSize?: number;
  footerMaxSize?: number;
  onHeaderResize?: (size: number) => void;
  onSidebarResize?: (size: number) => void;
  onAsideResize?: (size: number) => void;
  onFooterResize?: (size: number) => void;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLDivElement> | undefined;
};

export function AppShell({
  header,
  sidebar,
  aside,
  footer,
  children,
  headerHeight = '4rem',
  footerHeight = '3rem',
  sidebarWidth = '15rem',
  asideWidth = '15rem',
  headerCollapsed = false,
  sidebarCollapsed = false,
  asideCollapsed = false,
  footerCollapsed = false,
  headerResizable = false,
  sidebarResizable = false,
  asideResizable = false,
  footerResizable = false,
  headerMinSize = 4,
  headerMaxSize = 30,
  sidebarMinSize = 10,
  sidebarMaxSize = 40,
  asideMinSize = 10,
  asideMaxSize = 40,
  footerMinSize = 3,
  footerMaxSize = 20,
  onHeaderResize,
  onSidebarResize,
  onAsideResize,
  onFooterResize,
  className,
  style,
  ref,
}: AppShellProps): ReactElement {
  const showHeader = header != null && !headerCollapsed;
  const showSidebar = sidebar != null && !sidebarCollapsed;
  const showAside = aside != null && !asideCollapsed;
  const showFooter = footer != null && !footerCollapsed;

  const headerDefaultSize = typeof headerHeight === 'number' ? headerHeight / 10 : 6;
  const footerDefaultSize = typeof footerHeight === 'number' ? footerHeight / 10 : 5;
  const sidebarDefaultSize = typeof sidebarWidth === 'number' ? sidebarWidth / 10 : 20;
  const asideDefaultSize = typeof asideWidth === 'number' ? asideWidth / 10 : 20;

  const cssVars = {
    ['--ui-shell-header-height']:
      typeof headerHeight === 'number' ? `${String(headerHeight)}px` : headerHeight,
    ['--ui-shell-footer-height']:
      typeof footerHeight === 'number' ? `${String(footerHeight)}px` : footerHeight,
    ['--ui-shell-sidebar-width']: sidebarCollapsed
      ? '0px'
      : typeof sidebarWidth === 'number'
        ? `${String(sidebarWidth)}px`
        : sidebarWidth,
    ['--ui-shell-aside-width']: asideCollapsed
      ? '0px'
      : typeof asideWidth === 'number'
        ? `${String(asideWidth)}px`
        : asideWidth,
    ...style,
  } as CSSProperties;

  const hasResizableVertical = headerResizable || footerResizable;
  const hasResizableHorizontal = sidebarResizable || asideResizable;

  if (!hasResizableVertical && !hasResizableHorizontal) {
    return (
      <div ref={ref} className={cn('ui-shell', className)} style={cssVars}>
        {showHeader && <header className="ui-shell-header">{header}</header>}
        <div className="ui-shell-body">
          {showSidebar && <aside className="ui-shell-sidebar">{sidebar}</aside>}
          <main className="ui-shell-main">{children}</main>
          {showAside && <aside className="ui-shell-aside">{aside}</aside>}
        </div>
        {showFooter && <footer className="ui-shell-footer">{footer}</footer>}
      </div>
    );
  }

  const renderHorizontalContent = (): ReactNode => {
    if (!hasResizableHorizontal) {
      return (
        <div className="ui-shell-body">
          {showSidebar && <aside className="ui-shell-sidebar">{sidebar}</aside>}
          <main className="ui-shell-main">{children}</main>
          {showAside && <aside className="ui-shell-aside">{aside}</aside>}
        </div>
      );
    }

    return (
      <ResizablePanelGroup direction="horizontal" className="ui-shell-body">
        {showSidebar && (
          <ResizablePanel
            defaultSize={sidebarDefaultSize}
            minSize={sidebarMinSize}
            maxSize={sidebarMaxSize}
            collapsed={sidebarCollapsed}
            direction="horizontal"
            onResize={onSidebarResize}
            className="ui-shell-sidebar"
          >
            {sidebar}
          </ResizablePanel>
        )}
        <div className="ui-shell-main">{children}</div>
        {showAside && (
          <ResizablePanel
            defaultSize={asideDefaultSize}
            minSize={asideMinSize}
            maxSize={asideMaxSize}
            collapsed={asideCollapsed}
            direction="horizontal"
            invertResize
            onResize={onAsideResize}
            className="ui-shell-aside"
          >
            {aside}
          </ResizablePanel>
        )}
      </ResizablePanelGroup>
    );
  };

  if (hasResizableVertical) {
    return (
      <ResizablePanelGroup
        ref={ref}
        direction="vertical"
        className={cn('ui-shell', 'ui-shell--resizable', className)}
        style={cssVars}
      >
        {showHeader && (
          <ResizablePanel
            defaultSize={headerDefaultSize}
            minSize={headerMinSize}
            maxSize={headerMaxSize}
            collapsed={headerCollapsed}
            direction="vertical"
            onResize={onHeaderResize}
            className="ui-shell-header"
          >
            {header}
          </ResizablePanel>
        )}
        <div className="ui-shell-content">{renderHorizontalContent()}</div>
        {showFooter && (
          <ResizablePanel
            defaultSize={footerDefaultSize}
            minSize={footerMinSize}
            maxSize={footerMaxSize}
            collapsed={footerCollapsed}
            direction="vertical"
            invertResize
            onResize={onFooterResize}
            className="ui-shell-footer"
          >
            {footer}
          </ResizablePanel>
        )}
      </ResizablePanelGroup>
    );
  }

  return (
    <div ref={ref} className={cn('ui-shell', className)} style={cssVars}>
      {showHeader && <header className="ui-shell-header">{header}</header>}
      {renderHorizontalContent()}
      {showFooter && <footer className="ui-shell-footer">{footer}</footer>}
    </div>
  );
}
