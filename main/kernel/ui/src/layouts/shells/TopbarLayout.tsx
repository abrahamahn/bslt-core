// main/kernel/ui/src/layouts/shells/TopbarLayout.tsx
import { cn } from '../../utils/cn';

import '../../styles/layouts.css';
import type { CSSProperties, ComponentPropsWithRef, ReactElement, ReactNode } from 'react';

export type TopbarLayoutProps = ComponentPropsWithRef<'header'> & {
  children?: ReactNode;
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  height?: string | number;
  bordered?: boolean;
  className?: string;
  style?: CSSProperties;
};

export function TopbarLayout({
  children,
  left,
  center,
  right,
  height = '3rem',
  bordered = true,
  className,
  style,
  ref,
  ...props
}: TopbarLayoutProps): ReactElement {
  const hasSlots = left !== undefined || center !== undefined || right !== undefined;

  const cssVars = {
    ['--ui-topbar-height']: typeof height === 'number' ? `${String(height)}px` : height,
    ...style,
  } as CSSProperties;

  return (
    <header
      ref={ref}
      className={cn('ui-topbar', bordered && 'ui-topbar--bordered', className)}
      style={cssVars}
      {...props}
    >
      {hasSlots ? (
        <>
          <div className="ui-topbar-section ui-topbar-section--left">{left}</div>
          <div className="ui-topbar-section ui-topbar-section--center">{center}</div>
          <div className="ui-topbar-section ui-topbar-section--right">{right}</div>
        </>
      ) : (
        children
      )}
    </header>
  );
}
