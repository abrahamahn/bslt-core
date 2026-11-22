// main/kernel/ui/src/components/AsyncBoundary.tsx
import { Suspense, type ComponentPropsWithRef, type ReactElement, type ReactNode } from 'react';

import { Alert } from '../elements/Alert';
import { Button } from '../elements/Button';
import { Spinner } from '../elements/Spinner';
import { Text } from '../elements/Text';
import { cn } from '../utils/cn';

import { Card } from './Card';
import { ErrorBoundary } from './ErrorBoundary';

import '../styles/components.css';

type AsyncBoundarySize = 'sm' | 'md' | 'lg';
type AsyncBoundaryVariant = 'inline' | 'card';

const SPINNER_SIZES: Record<AsyncBoundarySize, string> = {
  sm: '1rem',
  md: '1.5rem',
  lg: '2rem',
};

type AsyncBoundaryProps = Omit<ComponentPropsWithRef<'div'>, 'children'> & {
  children?: ReactNode;
  isLoading?: boolean;
  loadingText?: string;
  size?: AsyncBoundarySize;
  variant?: AsyncBoundaryVariant;
  loadingFallback?: ReactNode;
  errorMessage?: string | null;
  errorFallback?: ReactNode;
  errorTitle?: string;
  retryLabel?: string;
  onRetry?: () => void;
  suspense?: boolean;
};

export function AsyncBoundary({
  children = null,
  isLoading = false,
  loadingText = 'Loading...',
  size = 'md',
  variant = 'inline',
  loadingFallback,
  errorMessage = null,
  errorFallback,
  errorTitle = 'This section encountered an error',
  retryLabel = 'Try Again',
  onRetry,
  suspense = false,
  className,
  ref,
  ...rest
}: AsyncBoundaryProps): ReactElement | null {
  const spinnerSize = size in SPINNER_SIZES ? SPINNER_SIZES[size] : SPINNER_SIZES.md;

  const defaultLoading = (
    <div ref={ref} className={cn('loading-container', className)} {...rest}>
      <Spinner size={spinnerSize} />
      {loadingText !== '' ? <Text tone="muted">{loadingText}</Text> : null}
    </div>
  );

  if (isLoading) {
    const content = loadingFallback ?? defaultLoading;
    if (variant === 'card') {
      return <Card className={cn('p-4', className)}>{content}</Card>;
    }
    return <>{content}</>;
  }

  if (errorMessage != null && errorMessage !== '') {
    const content =
      errorFallback ??
      (onRetry !== undefined ? (
        <div className="ui-async-error" role="alert">
          <Alert tone="danger">{errorMessage}</Alert>
          <Button variant="secondary" size="small" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : (
        <Alert tone="danger">{errorMessage}</Alert>
      ));

    if (variant === 'card') {
      return <Card className={cn('p-4', className)}>{content}</Card>;
    }
    return <>{content}</>;
  }

  if (children === null) {
    return null;
  }

  const inner = suspense ? (
    <Suspense fallback={loadingFallback ?? defaultLoading}>{children}</Suspense>
  ) : (
    children
  );

  return (
    <ErrorBoundary
      fallback={(error: Error, reset: () => void): ReactElement => (
        <div className={cn('ui-async-error', className)} role="alert">
          <Text tone="danger" size="sm">
            {errorTitle}
          </Text>
          <Text tone="muted" size="sm">
            {error.message}
          </Text>
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              onRetry?.();
              reset();
            }}
          >
            {retryLabel}
          </Button>
        </div>
      )}
    >
      {inner}
    </ErrorBoundary>
  );
}
