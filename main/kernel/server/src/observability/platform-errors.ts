// main/kernel/server/src/observability/platform-errors.ts
/**
 * `POST /api/platform/errors`: crash reports from consenting browsers, each
 * accepted request logged as one `Client error report` error event.
 *
 * The route is public, so it is a write path into production logs that anyone
 * can reach. It is bounded by the body limit, the batch schema, a per-IP limit
 * keyed on the socket address Fastify resolved (never a client header), and a
 * ceiling for the whole process, on top of the global per-IP limiter. The
 * payload is never echoed: the route declares its schema for the route manifest
 * and the API snapshot but validates in the handler, where an invalid body gets
 * one fixed message, because the schema's own messages quote the offending key
 * or value. An accepted body is masked again before it is logged, because the
 * browser is not trusted to have masked it.
 *
 * The body is exempt from the server's injection heuristics (owner decision,
 * 2026-11-16): minified stack traces and error messages contain `--`, `/*` and
 * `select ... from`, and the reports only ever reach the log, never a query.
 */
import {
  BadRequestError,
  ERROR_REPORT_LIMITS,
  errorReportBatchSchema,
  MS_PER_MINUTE,
  sanitizeErrorReport,
  TooManyRequestsError,
} from '@bslt/contract';

import { createRouteMap, publicRoute, withRouteOptions, type RouteMap } from '../http/routing';
import { createSlidingWindowLimiter } from '../security/sliding-rate-limit';

const REPORTS_PER_IP_PER_MINUTE = 10;
const REPORTS_PER_PROCESS_PER_MINUTE = 300;

type Limiter = ReturnType<typeof createSlidingWindowLimiter>;

function admit(limiter: Limiter, key: string): void {
  const { allowed, resetTime } = limiter(key);
  if (!allowed) {
    throw new TooManyRequestsError('Too many error reports', undefined, {
      retryAfterMs: resetTime - Date.now(),
    });
  }
}

export function buildPlatformErrorsRouteMap(): RouteMap {
  const perIp = createSlidingWindowLimiter(MS_PER_MINUTE, REPORTS_PER_IP_PER_MINUTE);
  const perProcess = createSlidingWindowLimiter(MS_PER_MINUTE, REPORTS_PER_PROCESS_PER_MINUTE);

  return createRouteMap([
    [
      'platform/errors',
      withRouteOptions(
        {
          ...publicRoute(
            'POST',
            (_ctx, body, req) => {
              admit(perIp, req.ip);
              admit(perProcess, 'process');
              const parsed = errorReportBatchSchema.safeParse(body);
              if (!parsed.success) throw new BadRequestError('Invalid error report');
              req.log.error(
                { clientErrors: parsed.data.reports.map(sanitizeErrorReport) },
                'Client error report',
              );
              return { status: 204, body: undefined };
            },
            errorReportBatchSchema,
            { summary: 'Report client errors (consent-gated, masked)', tags: ['System'] },
          ),
          skipBodyValidation: true,
        },
        { bodyLimit: ERROR_REPORT_LIMITS.bodyBytes, skipBodyInjectionFilter: true },
      ),
    ],
  ]);
}
