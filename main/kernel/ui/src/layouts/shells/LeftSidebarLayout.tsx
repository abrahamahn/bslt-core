// main/kernel/ui/src/layouts/shells/LeftSidebarLayout.tsx
import { cn } from '../../utils/cn';

import '../../styles/layouts.css';
import type { CSSProperties, ComponentPropsWithRef, ReactElement, ReactNode } from 'react';

export type LeftSidebarLayoutProps = Omit<ComponentPropsWithRef<'aside'>, 'content'> & {
  children?: ReactNode;
  header?: ReactNode;
  content?: ReactNode;
  footer?: ReactNode;
  width?: string | number;
  bordered?: boolean;
  className?: string;
  style?: CSSProperties;
};

export function LeftSidebarLayout({
  children,
  header,
  content,
  footer,
  width = '3.125rem',
  bordered = true,
  className,
  style,
  ref,
  ...props
}: LeftSidebarLayoutProps): ReactElement {
  const hasSlots = header !== undefined || content !== undefined || footer !== undefined;

  const cssVars = {
    ['--ui-left-sidebar-width']: typeof width === 'number' ? `${String(width)}px` : width,
    ...style,
  } as CSSProperties;

  return (
    <aside
      ref={ref}
      className={cn('ui-left-sidebar', bordered && 'ui-left-sidebar--bordered', className)}
      style={cssVars}
      {...props}
    >
      {hasSlots ? (
        <>
          {header != null && <div className="ui-left-sidebar-header">{header}</div>}
          {content != null && <div className="ui-left-sidebar-content">{content}</div>}
          {footer != null && <div className="ui-left-sidebar-footer">{footer}</div>}
        </>
      ) : (
        children
      )}
    </aside>
  );
}
