// main/apps/web/src/lib/errorReporter.test.ts
/**
 * The consent store memoises its decision, so every test boots a fresh module
 * graph and imports the reporter and the store through the SAME graph: a test
 * that wrote into another graph's store would prove nothing.
 */
import {
  AppError,
  BadRequestError,
  ERROR_REPORT_LIMITS,
  ForbiddenError,
  InternalError,
  TooManyRequestsError,
  type ErrorReport,
} from '@bslt/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ReporterModule = typeof import('./errorReporter');
type ConsentModule = typeof import('@bslt/compliance/web');

const FLUSH_DELAY_MS = 2000;
const HEX_64 = 'f0'.repeat(32);
const stops: Array<() => void> = [];

async function boot(): Promise<{ reporter: ReporterModule; consent: ConsentModule }> {
  const reporter = await import('./errorReporter');
  const consent = await import('@bslt/compliance/web');
  consent.resetConsentCache();
  return { reporter, consent };
}

/** A started reporter over a send spy; analytics granted unless `grant` is false. */
async function start(options: { grant?: boolean; send?: () => Promise<unknown> } = {}) {
  const { reporter, consent } = await boot();
  if (options.grant !== false) consent.writeConsent({ analytics: 'granted' });
  const send = vi.fn((_reports: readonly ErrorReport[]): Promise<unknown> =>
    options.send === undefined ? Promise.resolve() : options.send(),
  );
  stops.push(reporter.startErrorReporter(send));
  const sent = (): ErrorReport[] => send.mock.calls.flatMap(([reports]) => [...reports]);
  return { reporter, consent, send, sent };
}

function storeRawConsent(raw: string): void {
  window.localStorage.setItem('bslt.consent.v1', raw);
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/dashboard');
});

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('consent gate', () => {
  const updatedAt = new Date(0).toISOString();
  const withoutAnalytics: Array<[string, () => void]> = [
    ['no decision', () => undefined],
    [
      'analytics denied',
      () => storeRawConsent(JSON.stringify({ analytics: 'denied', ads: 'unset', updatedAt })),
    ],
    [
      'ads only',
      () => storeRawConsent(JSON.stringify({ analytics: 'unset', ads: 'granted', updatedAt })),
    ],
    ['a tampered decision', () => storeRawConsent('{"analytics":"granted"}')],
    ['a decision that is not JSON', () => storeRawConsent('granted')],
    [
      'storage that throws',
      () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
          throw new DOMException('blocked', 'SecurityError');
        });
      },
    ],
  ];

  it.each(withoutAnalytics)('sends nothing with %s', async (_label, arrange) => {
    arrange();
    const { reporter, send } = await start({ grant: false });

    expect(reporter.reportError(new Error('boom'), 'error')).toBe(false);
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);

    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing before the reporter is started', async () => {
    const { reporter, consent } = await boot();
    consent.writeConsent({ analytics: 'granted' });

    expect(reporter.reportError(new Error('boom'), 'error')).toBe(false);
  });

  it('drops a queued report when consent is revoked before the flush', async () => {
    const { reporter, consent, send } = await start();

    expect(reporter.reportError(new Error('boom'), 'error')).toBe(true);
    consent.writeConsent({ analytics: 'denied' });
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);

    expect(send).not.toHaveBeenCalled();
  });
});

describe('batching and limits', () => {
  it('sends one batch two seconds after the first report', async () => {
    const { reporter, send, sent } = await start();

    reporter.reportError(new Error('one'), 'error');
    reporter.reportError(new Error('two'), 'unhandledrejection');
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS - 1);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(send).toHaveBeenCalledTimes(1);
    expect(sent().map((report) => [report.source, report.message])).toEqual([
      ['error', 'one'],
      ['unhandledrejection', 'two'],
    ]);
  });

  it('sends at once when a batch is full', async () => {
    const { reporter, send } = await start();

    for (let i = 0; i < ERROR_REPORT_LIMITS.reports; i += 1) {
      reporter.reportError(new Error(`error ${String(i)}`), 'error');
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toHaveLength(ERROR_REPORT_LIMITS.reports);
  });

  it('sends a duplicate once', async () => {
    const { reporter, sent } = await start();

    const results = [1, 2, 3].map(() => reporter.reportError(new Error('same'), 'error'));
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);

    expect(results).toEqual([true, false, false]);
    expect(sent()).toHaveLength(1);
  });

  it('sends at most 20 reports from one page', async () => {
    const { reporter, sent } = await start();

    const results = Array.from({ length: 21 }, (_, i) =>
      reporter.reportError(new Error(`error ${String(i)}`), 'error'),
    );
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);

    expect(results.filter(Boolean)).toHaveLength(20);
    expect(results.at(-1)).toBe(false);
    expect(sent()).toHaveLength(20);
  });

  it('flushes on pagehide', async () => {
    const { reporter, send } = await start();

    reporter.reportError(new Error('leaving'), 'error');
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('packs every batch inside the body limit, even with non-ASCII text at full length', async () => {
    const { reporter, send, sent } = await start();
    const wide = '界'.repeat(ERROR_REPORT_LIMITS.stack);

    for (let i = 0; i < ERROR_REPORT_LIMITS.reports; i += 1) {
      const error = new Error(`${String(i)}${'語'.repeat(ERROR_REPORT_LIMITS.message)}`);
      error.stack = wide;
      reporter.reportError(error, 'error');
    }
    await vi.advanceTimersByTimeAsync(0);

    const bytes = send.mock.calls.map(
      ([reports]) => new TextEncoder().encode(JSON.stringify({ reports })).length,
    );
    expect(bytes.every((size) => size <= ERROR_REPORT_LIMITS.bodyBytes)).toBe(true);
    expect(sent()).toHaveLength(ERROR_REPORT_LIMITS.reports);
  });

  it('stops when stopped: the pending flush is cancelled and later reports are ignored', async () => {
    const { reporter, send } = await start();

    reporter.reportError(new Error('pending'), 'error');
    stops.splice(0).forEach((stop) => stop());
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);

    expect(send).not.toHaveBeenCalled();
    expect(reporter.reportError(new Error('later'), 'error')).toBe(false);
  });
});

describe('what is sent', () => {
  it('masks emails, tokens and query strings, and never sends the search or hash', async () => {
    window.history.replaceState({}, '', `/orgs/${HEX_64}/members?invite=s3cret#access_token=t0k3n`);
    const { reporter, sent } = await start();
    const error = new Error(`lookup for jane@example.com failed with ${HEX_64}`);
    error.stack = `Error: lookup failed\n    at f (https://app/x.js?token=s3cret:1:2)`;

    reporter.reportError(error, 'error');
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);

    const [report] = sent();
    expect(report).toEqual({
      source: 'error',
      name: 'Error',
      message: 'lookup for [email] failed with [redacted]',
      stack: 'Error: lookup failed\n    at f (https://app/x.js?[query]:1:2)',
      path: '/orgs/[redacted]/members',
    });
    const wire = JSON.stringify(sent());
    for (const secret of ['jane@', HEX_64, 's3cret', 't0k3n', 'invite']) {
      expect(wire).not.toContain(secret);
    }
  });

  it('masks before it truncates, so a token at the limit is never half-sent', async () => {
    const { reporter, sent } = await start();

    reporter.reportError(
      new Error(`${'a'.repeat(ERROR_REPORT_LIMITS.message - 10)} ${HEX_64}`),
      'error',
    );
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);

    expect(sent()[0]?.message).not.toContain('f0f0');
  });

  it.each([
    ['a failed fetch', new TypeError('Failed to fetch GET /api/users/me')],
    ['a ResizeObserver loop', new Error('ResizeObserver loop limit exceeded')],
    ['an abort', new DOMException('The user aborted a request.', 'AbortError')],
  ])('drops browser noise: %s', async (_label, error) => {
    const { reporter } = await start();

    expect(reporter.reportError(error, 'unhandledrejection')).toBe(false);
  });

  it('drops errors from browser extensions, by stack or by script URL', async () => {
    const { reporter } = await start();
    const fromExtension = new Error('extension crashed');
    fromExtension.stack =
      'Error: extension crashed\n    at x (chrome-extension://abc/content.js:1:2)';

    expect(reporter.reportError(fromExtension, 'error')).toBe(false);
    expect(
      reporter.reportError(new Error('also extension'), 'error', 'moz-extension://abc/inject.js'),
    ).toBe(false);
    const firefox = new Error('injected');
    firefox.stack = 'inject@moz-extension://abc/inject.js:1:2\nrun@https://app/assets/x.js:3:4\n';
    expect(reporter.reportError(firefox, 'error')).toBe(false);
  });

  it('reports an app error that an extension wrapper merely called', async () => {
    // Extensions wrap addEventListener, fetch and setTimeout, so their frames sit
    // below genuine app errors. Only the frame the error was thrown in counts.
    const { reporter, sent } = await start();
    const v8 = new TypeError('x is not a function');
    v8.stack = [
      'TypeError: x is not a function',
      '    at render (https://app/assets/index-AbC12.js:1:2)',
      '    at wrapped (chrome-extension://abc/content.js:3:4)',
    ].join('\n');
    const firefox = new Error('y is undefined');
    firefox.stack =
      'render@https://app/assets/x.js:1:2\nwrapped@moz-extension://abc/inject.js:3:4\n';
    const elsewhere = new Error('app URL that names the browser scheme');
    elsewhere.stack = 'Error: z\n    at f (https://app/go?to=chrome://settings:1:2)';

    expect(reporter.reportError(v8, 'error', 'https://app/assets/index-AbC12.js')).toBe(true);
    expect(reporter.reportError(firefox, 'unhandledrejection')).toBe(true);
    expect(reporter.reportError(elsewhere, 'error')).toBe(true);
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);

    expect(sent()).toHaveLength(3);
  });
});

describe('when a send fails', () => {
  it('drops a batch the server refuses as invalid (400) and keeps reporting', async () => {
    // One malformed batch says nothing about the next report.
    const refusals = [new BadRequestError('Invalid error report')];
    const { reporter, send, sent } = await start({
      send: () => {
        const refusal = refusals.shift();
        return refusal === undefined ? Promise.resolve() : Promise.reject(refusal);
      },
    });

    reporter.reportError(new Error('first'), 'error');
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);
    expect(reporter.reportError(new Error('later'), 'error')).toBe(true);
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);

    expect(send).toHaveBeenCalledTimes(2);
    expect(sent().at(-1)?.message).toBe('later');
  });

  it.each([
    ['rate-limited (429)', new TooManyRequestsError('Too many error reports')],
    ['failing (5xx)', new InternalError('Internal server error')],
    ['unreachable', new AppError('Failed to fetch', { code: 'NETWORK_ERROR', statusCode: 500 })],
    ['refusing the visitor (403)', new ForbiddenError('CSRF token invalid')],
  ])('stops reporting for the page when the endpoint is %s', async (_label, failure) => {
    const { reporter, send } = await start({ send: () => Promise.reject(failure) });

    reporter.reportError(new Error('first'), 'error');
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);

    expect(reporter.reportError(new Error('second'), 'error')).toBe(false);
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('never throws', () => {
  it('survives a sender that throws or rejects, and stops reporting for the page', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      for (const send of [
        (): Promise<unknown> => {
          throw new Error('sync');
        },
        (): Promise<unknown> => Promise.reject(new Error('async')),
      ]) {
        vi.resetModules();
        const { reporter } = await start({ send });

        expect(reporter.reportError(new Error('first'), 'error')).toBe(true);
        expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow();
        await vi.advanceTimersByTimeAsync(0);

        expect(reporter.reportError(new Error('second'), 'error')).toBe(false);
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('survives hostile thrown values', async () => {
    const { reporter } = await start();
    const trap = new Proxy(new Error('trap'), {
      get(target, property, receiver) {
        if (property === 'message') throw new Error('getter trap');
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    for (const value of [Object.create(null), trap, Symbol('thrown'), 10n, undefined]) {
      expect(() => reporter.reportError(value, 'unhandledrejection')).not.toThrow();
    }
  });

  it('touches no browser global when imported, so a prerender can load it', async () => {
    const addListener = vi.spyOn(window, 'addEventListener');

    await boot();

    expect(addListener).not.toHaveBeenCalled();
  });
});
