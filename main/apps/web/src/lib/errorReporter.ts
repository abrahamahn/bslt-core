// main/apps/web/src/lib/errorReporter.ts
/**
 * First-party crash reporting to `POST /api/platform/errors`, for visitors who
 * granted the `analytics` consent category and no one else.
 *
 * Consent is read when an error is captured and again when its batch is sent,
 * so a revocation drops what is still queued; storage that is unset, tampered
 * with or unreadable reads as no consent. Every field is masked (emails,
 * credentials, tokens, query strings) before it is queued, and the server masks
 * again. The path is `location.pathname`: the search and hash are never read.
 *
 * Bounded: browser noise and extension errors are dropped, a duplicate is sent
 * once, a page sends at most MAX_REPORTS_PER_PAGE, and a batch never exceeds
 * the route's body limit. A batch the server refuses as invalid (400) is
 * dropped alone: one malformed batch says nothing about the next report. Any
 * other failed send stops reporting for the page: the endpoint is down,
 * refusing or rate-limiting this visitor, and retrying would only add load.
 *
 * It never throws. It runs inside error handlers, where a throw would bury the
 * error being reported. It touches no browser global at import, so a server
 * render can load it.
 */
import { isHttpStatusError } from '@bslt/client-engine';
import { readConsent } from '@bslt/compliance/web';
import {
  ERROR_REPORT_LIMITS,
  HTTP_STATUS,
  sanitizeErrorReport,
  type ErrorReport,
  type ErrorReportSource,
} from '@bslt/contract';

type ErrorReportSender = (reports: readonly ErrorReport[]) => Promise<unknown>;

const MAX_REPORTS_PER_PAGE = 20;
const FLUSH_DELAY_MS = 2000;

/** Browser noise and transient network failures, matched against `name: message`. */
const NOISE = [
  'top.GLOBALS',
  'ResizeObserver loop',
  'Failed to fetch',
  'NetworkError',
  'Load failed',
  'AbortError',
];

/** A script URL of a browser extension or of the browser itself, where a frame names it. */
const EXTENSION_URL = /(?:^|[\s(@])(?:[a-z-]+-extension|chrome):\/\/|\/extensions\//i;

let send: ErrorReportSender | null = null;
let queue: ErrorReport[] = [];
let seen = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

type Thrown = Pick<ErrorReport, 'name' | 'message' | 'stack'>;

/**
 * Read by shape, not `instanceof Error`, which fails for an error from another
 * frame. Never through `String()`: a thrown object's `toString` can throw, or
 * say anything.
 */
function describeThrown(error: unknown): Thrown {
  if (typeof error === 'string') return { name: 'Error', message: error };
  const { name, message, stack } =
    typeof error === 'object' && error !== null
      ? (error as Partial<Record<keyof Thrown, unknown>>)
      : {};
  if (typeof message !== 'string') return { name: 'Error', message: 'Non-error value thrown' };
  return {
    name: typeof name === 'string' ? name : 'Error',
    message,
    ...(typeof stack === 'string' ? { stack } : {}),
  };
}

/**
 * The frame the error was thrown in: V8's first `at …` line, else the first
 * `fn@url` line (Firefox, Safari). Frames below it may be an extension's
 * wrapper around an app callback, which makes the error no less the app's.
 */
function throwSite(stack: string): string {
  const lines = stack.split('\n');
  return (
    lines.find((line) => line.trimStart().startsWith('at ')) ??
    lines.find((line) => line.includes('@')) ??
    ''
  );
}

function isNoise({ name, message, stack }: Thrown, filename: string | undefined): boolean {
  const text = `${name}: ${message}`;
  return (
    NOISE.some((noise) => text.includes(noise)) ||
    [throwSite(stack ?? ''), filename ?? ''].some((url) => EXTENSION_URL.test(url))
  );
}

function analyticsGranted(): boolean {
  return readConsent()?.analytics === 'granted';
}

function bodyBytes(reports: readonly ErrorReport[]): number {
  return new TextEncoder().encode(JSON.stringify({ reports })).length;
}

/** A report too large to travel alone loses its stack; without it, it always fits. */
function fitBody(report: ErrorReport): ErrorReport {
  if (bodyBytes([report]) <= ERROR_REPORT_LIMITS.bodyBytes) return report;
  const { stack: _dropped, ...rest } = report;
  return rest;
}

/** The longest run from the head of the queue that fits one request. */
function takeBatch(): ErrorReport[] {
  const batch: ErrorReport[] = [];
  for (const report of queue) {
    if (batch.length === ERROR_REPORT_LIMITS.reports) break;
    if (batch.length > 0 && bodyBytes([...batch, report]) > ERROR_REPORT_LIMITS.bodyBytes) break;
    batch.push(report);
  }
  queue = queue.slice(batch.length);
  return batch;
}

function halt(): void {
  clearTimeout(timer);
  timer = undefined;
  send = null;
  queue = [];
}

function flush(): void {
  clearTimeout(timer);
  timer = undefined;
  const sender = send;
  if (sender === null) return;
  try {
    if (!analyticsGranted()) {
      queue = [];
      return;
    }
    while (queue.length > 0) {
      const batch = takeBatch();
      void Promise.resolve()
        .then(() => sender(batch))
        .catch((error: unknown) => {
          if (send === sender && !isHttpStatusError(error, HTTP_STATUS.BAD_REQUEST)) halt();
        });
    }
  } catch {
    halt();
  }
}

/**
 * Starts sending: `sender` posts one batch. Errors reported before this are dropped.
 *
 * @returns Stops the reporter and forgets everything it held.
 */
export function startErrorReporter(sender: ErrorReportSender): () => void {
  send = sender;
  window.addEventListener('pagehide', flush);
  return () => {
    window.removeEventListener('pagehide', flush);
    halt();
    seen = new Set();
  };
}

/**
 * Queues one error for reporting.
 *
 * @param filename - The script an `ErrorEvent` came from, to drop extension errors.
 * @returns Whether the error was queued.
 */
export function reportError(error: unknown, source: ErrorReportSource, filename?: string): boolean {
  try {
    if (send === null || seen.size >= MAX_REPORTS_PER_PAGE || !analyticsGranted()) return false;
    const thrown = describeThrown(error);
    if (isNoise(thrown, filename)) return false;

    const report = fitBody(
      sanitizeErrorReport({ source, ...thrown, path: window.location.pathname }),
    );
    const key = `${report.source}|${report.name}|${report.message}`;
    if (seen.has(key)) return false;
    seen.add(key);

    queue.push(report);
    if (queue.length >= ERROR_REPORT_LIMITS.reports) flush();
    else timer ??= setTimeout(flush, FLUSH_DELAY_MS);
    return true;
  } catch {
    return false;
  }
}
