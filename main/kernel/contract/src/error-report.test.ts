// main/kernel/contract/src/error-report.test.ts
import { describe, expect, it } from 'vitest';

import {
  ERROR_REPORT_LIMITS,
  ERROR_REPORT_SOURCES,
  errorReportBatchSchema,
  maskErrorText,
  sanitizeErrorReport,
  type ErrorReport,
} from './error-report';

const HEX_64 = 'f0'.repeat(32);
const UUID = '550e8400-e29b-41d4-a716-446655440000';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwiZW1haWwiOiJhQGIuYyJ9.c2lnbmF0dXJlLXNpZ25hdHVyZQ';

function report(overrides: Partial<ErrorReport> = {}): ErrorReport {
  return {
    source: 'error',
    name: 'TypeError',
    message: 'x is not a function',
    path: '/dashboard',
    ...overrides,
  };
}

describe('maskErrorText', () => {
  it('masks an email inside a sentence', () => {
    expect(maskErrorText('Lookup failed for jane.doe+qa@example.co.uk today')).toBe(
      'Lookup failed for [email] today',
    );
    expect(maskErrorText('first_last@example.com,(ops@münchen.de)')).toBe('[email],([email])');
  });

  it('masks Bearer and Basic credentials', () => {
    expect(maskErrorText('Authorization: Bearer abc.def')).toBe('Authorization: Bearer [redacted]');
    expect(maskErrorText('Authorization: Basic dXNlcjpwYXNz')).toBe(
      'Authorization: Basic [redacted]',
    );
  });

  it('masks every segment of a JWT', () => {
    const masked = maskErrorText(`token ${JWT} rejected`);

    expect(masked).toBe('token [jwt] rejected');
    for (const segment of JWT.split('.')) expect(masked).not.toContain(segment);
  });

  it('masks the 64-hex unsubscribe token and a UUID', () => {
    expect(maskErrorText(`/email/unsubscribe/${HEX_64}`)).toBe('/email/unsubscribe/[redacted]');
    expect(maskErrorText(`org ${UUID} missing`)).toBe('org [redacted] missing');
  });

  it('masks query strings and fragments that carry parameters', () => {
    expect(maskErrorText('GET https://x/y?token=s3cret&uid=1 failed')).toBe(
      'GET https://x/y?[query] failed',
    );
    expect(maskErrorText('https://app/cb#access_token=abc&state=1')).toBe(
      'https://app/cb#[fragment]',
    );
  });

  it("keeps a frame's line and column after a masked query", () => {
    expect(maskErrorText('at f (https://app/x.js?v=abc:1:2)')).toBe(
      'at f (https://app/x.js?[query]:1:2)',
    );
  });

  it('leaves ordinary messages and stack frames readable', () => {
    const readable = [
      "TypeError: Cannot read properties of undefined (reading 'map')",
      'at f (https://app/assets/index-AbC12.js:1:2)',
      'at renderOrganizationMembershipSettingsPanelWithPermissions (http://localhost/src/x.tsx:10:5)',
      'at http://localhost/node_modules/@bslt/ui/dist/index.js:3:9',
      'Did you mean foo? Try again',
      'Issue #123 is open',
    ];
    for (const text of readable) expect(maskErrorText(text)).toBe(text);
  });

  it('is idempotent', () => {
    const text = `a@b.co Bearer ${JWT} https://x/y?t=1#k=v ${UUID} at f (https://a/x.js?v=1:3:4)`;
    const once = maskErrorText(text);

    expect(maskErrorText(once)).toBe(once);
  });

  it('masks adversarial input in linear time', () => {
    // Shapes that backtrack quadratically under an unbounded email pattern:
    // about 40 ms per 4000-character field, so about 0.5 s for one request.
    // `eyJ-` restarts a JWT pattern anchored on `\b` after every hyphen.
    const hostile = (size: number): string[] => [
      `@${'b'.repeat(size)}`,
      `${'a'.repeat(size / 2)}@${'b'.repeat(size / 2)}`,
      'a@'.repeat(size / 2),
      'eyJ-'.repeat(size / 4),
      `?${'a='.repeat(size / 2)}`,
      `Bearer ${'x'.repeat(size)}`,
      `${'1'.repeat(size)}:`,
    ];
    const atLimit = (text: string, field: 'name' | 'message' | 'stack' | 'path'): string =>
      text.slice(0, ERROR_REPORT_LIMITS[field]);
    const batch = hostile(ERROR_REPORT_LIMITS.stack)
      .slice(0, ERROR_REPORT_LIMITS.reports)
      .map((text) =>
        report({
          name: atLimit(text, 'name'),
          message: atLimit(text, 'message'),
          stack: atLimit(text, 'stack'),
          path: atLimit(text, 'path'),
        }),
      );

    const started = Date.now();
    batch.forEach((entry) => sanitizeErrorReport(entry));
    // Ten times a stack: quadratic would take seconds here, linear a few ms.
    hostile(10 * ERROR_REPORT_LIMITS.stack).forEach((text) => maskErrorText(text));

    expect(Date.now() - started).toBeLessThan(250);
  });
});

describe('sanitizeErrorReport', () => {
  it('masks before it truncates, so a token cut at the limit never leaks', () => {
    const message = `${'a'.repeat(ERROR_REPORT_LIMITS.message - 10)} ${HEX_64}`;

    const clean = sanitizeErrorReport(report({ message }));

    expect(clean.message).toHaveLength(ERROR_REPORT_LIMITS.message);
    expect(clean.message).not.toContain('f0f0');
  });

  it('cuts over-long raw text between words, never through a token', () => {
    // 30 hex tokens shrink to "[redacted]" each, so the text cut at four times
    // the limit is short enough to show the token that straddles the cut.
    const masked = `${HEX_64} `.repeat(30);
    const pad = 'z'.repeat(ERROR_REPORT_LIMITS.message * 4 - masked.length - 16);
    const message = `${masked}${pad} ${'ab12'.repeat(16)}`;

    const clean = sanitizeErrorReport(report({ message }));

    expect(clean.message).not.toContain('ab12');
  });

  it('caps every field and keeps an omitted stack omitted', () => {
    const long = 'word '.repeat(2000);

    const clean = sanitizeErrorReport(report({ name: long, message: long, path: long }));

    expect(clean.name.length).toBeLessThanOrEqual(ERROR_REPORT_LIMITS.name);
    expect(clean.message.length).toBeLessThanOrEqual(ERROR_REPORT_LIMITS.message);
    expect(clean.path.length).toBeLessThanOrEqual(ERROR_REPORT_LIMITS.path);
    expect('stack' in clean).toBe(false);
    expect(errorReportBatchSchema.safeParse({ reports: [clean] }).success).toBe(true);
  });

  it('fits one report without its stack into the body limit, whatever its characters', () => {
    // A control character is the worst case: JSON escapes it to six bytes.
    const worst = '\u0001';
    const body = JSON.stringify({
      reports: [
        report({
          source: 'unhandledrejection',
          name: worst.repeat(ERROR_REPORT_LIMITS.name),
          message: worst.repeat(ERROR_REPORT_LIMITS.message),
          path: worst.repeat(ERROR_REPORT_LIMITS.path),
        }),
      ],
    });

    // Every escape is ASCII, so the string length is the byte length.
    expect(body.length).toBeLessThanOrEqual(ERROR_REPORT_LIMITS.bodyBytes);
  });
});

describe('errorReportBatchSchema', () => {
  const accepts = (body: unknown): boolean => errorReportBatchSchema.safeParse(body).success;

  it('accepts a full batch with the stack omitted', () => {
    const reports = ERROR_REPORT_SOURCES.flatMap((source) => [report({ source })]);
    while (reports.length < ERROR_REPORT_LIMITS.reports) reports.push(report());

    expect(accepts({ reports })).toBe(true);
    expect(accepts({ reports: [report({ stack: 'at f (x.js:1:2)' })] })).toBe(true);
  });

  it('rejects unknown keys, prototype keys and batch sizes outside 1 to 5', () => {
    expect(accepts({ reports: [report()], extra: 1 })).toBe(false);
    expect(accepts({ reports: [{ ...report(), extra: 1 }] })).toBe(false);
    expect(accepts(JSON.parse('{"reports":[],"__proto__":{"polluted":true}}'))).toBe(false);
    expect(accepts({ reports: [] })).toBe(false);
    expect(
      accepts({ reports: Array.from({ length: ERROR_REPORT_LIMITS.reports + 1 }, () => report()) }),
    ).toBe(false);
  });

  it('rejects an unknown source and over-long fields', () => {
    expect(accepts({ reports: [{ ...report(), source: 'console' }] })).toBe(false);
    for (const field of ['name', 'message', 'stack', 'path'] as const) {
      const tooLong = 'x'.repeat(ERROR_REPORT_LIMITS[field] + 1);
      expect(accepts({ reports: [report({ [field]: tooLong })] })).toBe(false);
    }
  });

  it('rejects bodies that are not an object', () => {
    for (const body of [null, undefined, 'reports', 42, [report()]]) {
      expect(accepts(body)).toBe(false);
    }
  });
});
