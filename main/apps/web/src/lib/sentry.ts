// Core edition has no external telemetry provider. The app's ErrorBoundary remains active.
import type { ComponentType, ReactNode } from 'react';
export async function initSentry(): Promise<void> {}
export function upgradeSentryForAnalyticsConsent(): void {}
export function gateSentryOnAnalyticsConsent(): () => void {
  return () => {};
}
export function addRouteChangeBreadcrumb(_from: string, _to: string): void {}
export function captureError(_error: unknown, _context?: Record<string, unknown>): void {}
export function setSentryUser(_user: { id: string; email?: string; role?: string } | null): void {}
export function SentryErrorBoundary({
  children,
}: {
  children?: ReactNode;
  fallback?: ReactNode;
}): ReactNode {
  return children;
}
export function withSentryProfiler<P extends Record<string, unknown>>(
  component: ComponentType<P>,
): ComponentType<P> {
  return component;
}
