// Core logs production errors locally. External telemetry is supplied by Pro.
import { ConsoleErrorTrackingProvider } from './console.provider';
import { NoopErrorTrackingProvider } from './noop.provider';
import type { ErrorTrackingConfig, ErrorTrackingProvider } from '@bslt/shared/system/observability';
export function createErrorTracker(config: ErrorTrackingConfig): ErrorTrackingProvider {
  return config.environment === 'production'
    ? new ConsoleErrorTrackingProvider()
    : new NoopErrorTrackingProvider();
}
