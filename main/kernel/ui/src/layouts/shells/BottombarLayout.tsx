// main/kernel/ui/src/layouts/shells/BottombarLayout.tsx
import { cn } from '../../utils/cn';

import '../../styles/layouts.css';
import type { CSSProperties, ComponentPropsWithRef, ReactElement, ReactNode } from 'react';

export type BottombarLayoutProps = ComponentPropsWithRef<'footer'> & {
  children?: ReactNode;
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  height?: string | number;
  bordered?: boolean;
  className?: string;
  style?: CSSProperties;
};

export function BottombarLayout({
  children,
  left,
  center,
  right,
  height = '2.5rem',
  bordered = true,
  className,
  style,
  ref,
  ...props
}: BottombarLayoutProps): ReactElement {
  const hasSlots = left !== undefined || center !== undefined || right !== undefined;

  const cssVars = {
    ['--ui-bottombar-height']: typeof height === 'number' ? `${String(height)}px` : height,
    ...style,
  } as CSSProperties;

  return (
    <footer
      ref={ref}
      className={cn('ui-bottombar', bordered && 'ui-bottombar--bordered', className)}
      style={cssVars}
      {...props}
    >
      {hasSlots ? (
        <>
          <div className="ui-bottombar-section ui-bottombar-section--left">{left}</div>
          <div className="ui-bottombar-section ui-bottombar-section--center">{center}</div>
          <div className="ui-bottombar-section ui-bottombar-section--right">{right}</div>
        </>
      ) : (
        children
      )}
    </footer>
  );
}
