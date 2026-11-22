// main/modules/audit/contract/errors.test.ts
import { describe, expect, it } from 'vitest';

import { defineErrors, lookupErrorCode } from '@bslt/contract';

import { auditErrors } from './errors';

describe('auditErrors', () => {
  it('registers audit.SECURITY_EVENT_NOT_FOUND with HTTP 404', () => {
    expect(auditErrors.SECURITY_EVENT_NOT_FOUND).toBe('audit.SECURITY_EVENT_NOT_FOUND');
    expect(lookupErrorCode(auditErrors.SECURITY_EVENT_NOT_FOUND)).toMatchObject({
      code: 'audit.SECURITY_EVENT_NOT_FOUND',
      status: 404,
      kind: 'not_found',
    });
  });

  it('returns undefined for unregistered audit error codes', () => {
    expect(lookupErrorCode('audit.UNKNOWN_CODE')).toBeUndefined();
    expect(lookupErrorCode('audit.')).toBeUndefined();
  });

  it('rejects conflicting re-registration and invalid error keys', () => {
    expect(() => defineErrors('audit', { SECURITY_EVENT_NOT_FOUND: 500 })).toThrow(
      /already registered/iu,
    );
    expect(() => defineErrors('Audit', { BAD_KEY: 404 })).toThrow();
    expect(() => defineErrors('audit_bad', { badKey: 404 })).toThrow();
  });
});
