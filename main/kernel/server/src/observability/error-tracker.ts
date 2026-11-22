// main/kernel/server/src/observability/error-tracker.ts
/**
 * The ErrorTracker port over the platform logger. A captured server error is a
 * structured error event in the log pipeline, in every environment, with no
 * vendor SDK and no DSN to set.
 */
import type { Logger } from '../logger/types';
import type { ErrorTracker } from '@bslt/contract';

/**
 * `String()` of an object can throw (no prototype, a throwing `toPrimitive`), and
 * this runs inside the HTTP error handler, so an object gets a fixed message.
 */
function asError(value: unknown): Error {
  if (value instanceof Error) return value;
  const isObject = (typeof value === 'object' && value !== null) || typeof value === 'function';
  return new Error(isObject ? 'Non-error value thrown' : String(value));
}

export function createLogErrorTracker(log: Logger): ErrorTracker {
  return {
    captureError: (error, context) => {
      log.error(asError(error), 'Captured server error', context);
    },
    addBreadcrumb: (message, data) => {
      log.debug(data ?? {}, message);
    },
    setUserContext: () => {
      // Deliberately nothing: the user's email has no place in an error event.
    },
  };
}
