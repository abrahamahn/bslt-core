// main/kernel/ui/src/elements/Box.tsx
import { cn } from '../utils/cn';

import '../styles/elements.css';
import type { CSSProperties, ReactElement, ReactNode, Ref } from 'react';

type BoxProps = {
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
  padding?: number | string;
  flexDirection?: 'row' | 'column';
  ref?: Ref<HTMLDivElement> | undefined;
};

export function Box({
  children,
  style,
  className,
  padding,
  flexDirection,
  ref,
}: BoxProps): ReactElement {
  const boxPadding = typeof padding === 'number' ? `${String(padding)}px` : padding;
  const combinedStyle: CSSProperties = {
    ...(flexDirection != null ? { ['--ui-box-direction']: flexDirection } : {}),
    ...(boxPadding != null ? { ['--ui-box-padding']: boxPadding } : {}),
    ...style,
  };

  return (
    <div ref={ref} className={cn('box', className)} style={combinedStyle}>
      {children}
    </div>
  );
}
