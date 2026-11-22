// main/kernel/contract/src/error-report.ts
/**
 * The wire format of `POST /api/platform/errors`: crash reports from browsers
 * whose visitor granted the `analytics` consent category.
 *
 * Masking lives here so the browser and the server apply one set of rules. The
 * browser masks before anything leaves the page; the server masks again,
 * because a client is never trusted to have done it. The server runs the rules
 * on anonymous input, so every pattern is linear in its input: quantifiers that
 * could backtrack are bounded, and the digit check of a long run is done in the
 * replacement, not with a lookahead.
 */
import { array, enumOf, object, optional, string, type Infer } from '@bslt/schema';

export const ERROR_REPORT_SOURCES = ['error', 'unhandledrejection', 'render'] as const;

/**
 * Characters per field, reports per batch, and the body ceiling in bytes. The
 * body ceiling keeps one batch inside the route's body limit, the fetch
 * keepalive quota and one log line. A report without its stack always fits it:
 * 900 characters JSON-escaped to at most six bytes each.
 */
export const ERROR_REPORT_LIMITS = {
  reports: 5,
  name: 100,
  message: 500,
  stack: 4000,
  path: 300,
  bodyBytes: 8 * 1024,
} as const;

const errorReportSchema = object({
  source: enumOf(ERROR_REPORT_SOURCES, 'source'),
  name: string({ max: ERROR_REPORT_LIMITS.name }),
  message: string({ max: ERROR_REPORT_LIMITS.message }),
  stack: optional(string({ max: ERROR_REPORT_LIMITS.stack })),
  path: string({ max: ERROR_REPORT_LIMITS.path }),
});

export const errorReportBatchSchema = object({
  reports: array(errorReportSchema, { min: 1, max: ERROR_REPORT_LIMITS.reports }),
});

export type ErrorReport = Infer<typeof errorReportSchema>;
export type ErrorReportSource = (typeof ERROR_REPORT_SOURCES)[number];

/**
 * The email and the JWT start after a character that cannot belong to them, so
 * a run of their characters is tried once, not from each of its positions (`\b`
 * would restart after every hyphen). That capture stands in for a lookbehind,
 * which older Safari cannot parse.
 */
const EMAIL =
  /(^|[^\p{L}\p{N}_.%+-])[\p{L}\p{N}_.%+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63})+/gu;
const JWT = /(^|[^\w-])eyJ[\w-]+\.[\w-]+\.[\w-]*/g;
const CREDENTIAL = /\b(Bearer|Basic)\s+[\w.~+/-]+=*/gi;
const QUERY = /\?[^\s#()"'`<>]+/g;
const FRAGMENT = /#[^\s()"'`<>]+/g;
/** 32 or more: JWT segments, hex tokens, API keys, UUIDs. Masked only with a digit in it. */
const LONG_RUN = /[\w-]{32,}/g;
const DIGIT = /\d/;
/** A stack frame's `:line:column`, which follows a script URL's query. */
const FRAME_POSITION = /:\d+:\d+$/;

/** A query or fragment is masked only when it carries a parameter. */
function maskParameters(marker: string): (match: string) => string {
  return (match) =>
    match.includes('=') ? `${marker}${FRAME_POSITION.exec(match)?.[0] ?? ''}` : match;
}

/**
 * Masks emails, credentials, JWTs, query strings and fragments with parameters,
 * and long token-like runs. Names, phone numbers and addresses pass through:
 * this is a regular-expression mask, not a PII detector. Idempotent.
 */
export function maskErrorText(text: string): string {
  return text
    .replace(EMAIL, '$1[email]')
    .replace(JWT, '$1[jwt]')
    .replace(CREDENTIAL, '$1 [redacted]')
    .replace(QUERY, maskParameters('?[query]'))
    .replace(FRAGMENT, maskParameters('#[fragment]'))
    .replace(LONG_RUN, (run) => (DIGIT.test(run) ? '[redacted]' : run));
}

/** Over-long raw text is cut at the last space or newline, never through a token. */
function capBetweenWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  return head.slice(0, Math.max(head.lastIndexOf(' '), head.lastIndexOf('\n'), 0));
}

/** Mask first, then truncate: a token cut at the limit would no longer match its rule. */
function clean(text: string, limit: number): string {
  return maskErrorText(capBetweenWords(text, limit * 4)).slice(0, limit);
}

/** Masks every field and caps it to its limit. The browser runs it before sending, the server again. */
export function sanitizeErrorReport(report: ErrorReport): ErrorReport {
  return {
    source: report.source,
    name: clean(report.name, ERROR_REPORT_LIMITS.name),
    message: clean(report.message, ERROR_REPORT_LIMITS.message),
    ...(report.stack === undefined
      ? {}
      : { stack: clean(report.stack, ERROR_REPORT_LIMITS.stack) }),
    path: clean(report.path, ERROR_REPORT_LIMITS.path),
  };
}
