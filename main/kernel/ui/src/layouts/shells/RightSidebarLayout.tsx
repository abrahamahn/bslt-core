// main/kernel/ui/src/layouts/shells/RightSidebarLayout.tsx
import { cn } from '../../utils/cn';

import '../../styles/layouts.css';
import type { CSSProperties, ComponentPropsWithRef, ReactElement, ReactNode } from 'react';

export type RightSidebarLayoutProps = Omit<ComponentPropsWithRef<'aside'>, 'content'> & {
  children?: ReactNode;
  header?: ReactNode;
  content?: ReactNode;
  width?: string | number;
  bordered?: boolean;
  onClose?: () => void;
  className?: string;
  style?: CSSProperties;
};

export function RightSidebarLayout({
  children,
  header,
  content,
  width = '20rem',
  bordered = true,
  onClose: _onClose,
  className,
  style,
  ref,
  ...props
}: RightSidebarLayoutProps): ReactElement {
  const hasSlots = header !== undefined || content !== undefined;

  const cssVars = {
    ['--ui-right-sidebar-width']: typeof width === 'number' ? `${String(width)}px` : width,
    ...style,
  } as CSSProperties;

  return (
    <aside
      ref={ref}
      className={cn('ui-right-sidebar', bordered && 'ui-right-sidebar--bordered', className)}
      style={cssVars}
      {...props}
    >
      {hasSlots ? (
        <>
          {header != null && <div className="ui-right-sidebar-header">{header}</div>}
          {content != null && <div className="ui-right-sidebar-content">{content}</div>}
        </>
      ) : (
        children
      )}
    </aside>
  );
}
