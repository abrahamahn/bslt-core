// main/kernel/server/src/observability/platform-errors.test.ts
import {
  BadRequestError,
  ERROR_REPORT_LIMITS,
  errorReportBatchSchema,
  TooManyRequestsError,
  type ErrorReport,
} from '@bslt/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildPlatformErrorsRouteMap } from './platform-errors';

import type { HttpReply, HttpRequest, RouteDefinition } from '../http';

const MARKER = 'INJECTED-MARKER-7f3a';

function route(): RouteDefinition {
  const definition = buildPlatformErrorsRouteMap().get('platform/errors');
  if (definition === undefined) throw new Error('platform/errors is not in the route map');
  return definition;
}

function request(ip = '203.0.113.7') {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { req: { ip, headers: {}, log } as unknown as HttpRequest, log };
}

function post(definition: RouteDefinition, body: unknown, req: HttpRequest): unknown {
  return definition.handler({}, body, req, {} as HttpReply);
}

function report(overrides: Partial<ErrorReport> = {}): ErrorReport {
  return { source: 'error', name: 'TypeError', message: 'boom', path: '/dashboard', ...overrides };
}

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the handler to throw');
}

describe('POST platform/errors', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is a public POST route with the report body limit', () => {
    const definition = route();

    expect(definition.method).toBe('POST');
    expect(definition.isPublic).toBe(true);
    expect(definition.routeOptions?.bodyLimit).toBe(ERROR_REPORT_LIMITS.bodyBytes);
  });

  it('opts its body out of the injection filter: crash text reads like SQL', () => {
    expect(route().routeOptions?.skipBodyInjectionFilter).toBe(true);
  });

  it('declares its body schema but leaves validating it to the handler', () => {
    const definition = route();

    // The route manifest and the API snapshot read the schema off the definition.
    expect(definition.schema).toBe(errorReportBatchSchema);
    expect(definition.skipBodyValidation).toBe(true);
  });

  it('logs one masked error event and answers 204 with no body', () => {
    const definition = route();
    const { req, log } = request();
    // A malicious client skips the browser's masking.
    const body = {
      reports: [
        report({
          message: `lookup for jane@example.com failed with ${'ab12'.repeat(16)}`,
          stack: 'at f (https://app/x.js?token=s3cret:1:2)',
          path: `/email/unsubscribe/${'f0'.repeat(32)}`,
        }),
      ],
    };

    expect(post(definition, body, req)).toEqual({ status: 204, body: undefined });

    expect(log.error).toHaveBeenCalledTimes(1);
    const [meta, message] = log.error.mock.calls[0] ?? [];
    expect(message).toBe('Client error report');
    expect(meta).toEqual({
      clientErrors: [
        report({
          message: 'lookup for [email] failed with [redacted]',
          stack: 'at f (https://app/x.js?[query]:1:2)',
          path: '/email/unsubscribe/[redacted]',
        }),
      ],
    });
    const logged = JSON.stringify(meta);
    for (const secret of ['jane@example.com', 'ab12ab12', 's3cret', 'f0f0f0']) {
      expect(logged).not.toContain(secret);
    }
  });

  it('rejects an invalid body with a fixed message that echoes nothing', () => {
    const definition = route();
    const { req, log } = request();
    const bodies = [
      { reports: [report()], [MARKER]: MARKER },
      { reports: [{ ...report(), source: MARKER }] },
      { reports: [report({ message: `${MARKER}${'x'.repeat(ERROR_REPORT_LIMITS.message)}` })] },
      MARKER,
    ];

    for (const body of bodies) {
      const error = thrown(() => post(definition, body, req));
      expect(error).toBeInstanceOf(BadRequestError);
      const wire = JSON.stringify((error as BadRequestError).toWire(false));
      expect((error as BadRequestError).message).toBe('Invalid error report');
      expect(wire).not.toContain(MARKER);
      expect((error as BadRequestError).cause).toBeUndefined();
    }
    expect(log.error).not.toHaveBeenCalled();
  });

  it('limits each IP to 10 reports a minute, and other IPs still pass', () => {
    const definition = route();
    const { req, log } = request('198.51.100.1');
    const body = { reports: [report()] };

    for (let i = 0; i < 10; i += 1) post(definition, body, req);
    const error = thrown(() => post(definition, body, req));

    expect(error).toBeInstanceOf(TooManyRequestsError);
    expect(log.error).toHaveBeenCalledTimes(10);
    expect(post(definition, body, request('198.51.100.2').req)).toEqual({
      status: 204,
      body: undefined,
    });
  });

  it('ignores X-Forwarded-For: the client cannot pick its own rate-limit key', () => {
    const definition = route();
    const body = { reports: [report()] };

    for (let i = 0; i < 10; i += 1) {
      const { req } = request('198.51.100.9');
      (req.headers as Record<string, string>)['x-forwarded-for'] = `10.0.0.${String(i)}`;
      post(definition, body, req);
    }

    expect(thrown(() => post(definition, body, request('198.51.100.9').req))).toBeInstanceOf(
      TooManyRequestsError,
    );
  });

  it('caps the whole process at 300 reports a minute across distinct IPs', () => {
    // A frozen clock: the window cannot roll over while the loop runs.
    vi.useFakeTimers({ now: new Date('2026-11-15T00:00:00Z') });
    const definition = route();
    const body = { reports: [report()] };
    let accepted = 0;

    for (let i = 0; i < 1000; i += 1) {
      try {
        post(definition, body, request(`2001:db8::${i.toString(16)}`).req);
        accepted += 1;
      } catch (error) {
        expect(error).toBeInstanceOf(TooManyRequestsError);
      }
    }

    expect(accepted).toBe(300);
  });
});
