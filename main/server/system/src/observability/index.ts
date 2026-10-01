// main/server/system/src/observability/index.ts

export { ConsoleErrorTrackingProvider } from './console.provider';
export { createErrorTracker } from './factory';
export {
  formatPrometheusMetrics,
  getMetricsCollector,
  MetricsCollector,
  resetMetricsCollector,
  type MetricsSummary,
} from '@bslt/shared/system/observability';
export { NoopErrorTrackingProvider } from './noop.provider';
export { addBreadcrumb, captureError, initSentry, setUserContext } from './sentry';
export type {
  Breadcrumb,
  BreadcrumbLevel,
  ErrorContext,
  ErrorTrackingConfig,
  ErrorTrackingProvider,
} from '@bslt/shared/system/observability';
