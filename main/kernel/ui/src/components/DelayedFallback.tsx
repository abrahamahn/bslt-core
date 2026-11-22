// main/kernel/ui/src/components/DelayedFallback.tsx
import { useDelayedFlag } from '@bslt/react/hooks';

import { AsyncBoundary } from './AsyncBoundary';

import type { ReactElement, ReactNode } from 'react';

export interface DelayedFallbackProps {
  delay?: number;
  children?: ReactNode;
  text?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const DelayedFallback = ({
  delay = 150,
  children,
  text = '',
  size = 'md',
}: DelayedFallbackProps): ReactElement | null => {
  const showFallback = useDelayedFlag(true, delay);

  if (!showFallback) {
    return null;
  }

  if (children != null) {
    return <>{children}</>;
  }

  return (
    <div className="flex-center h-screen">
      <AsyncBoundary isLoading loadingText={text} size={size} />
    </div>
  );
};
