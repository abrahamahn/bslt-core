// main/modules/compliance/contract/errors.test.ts
import { describe, expect, it } from 'vitest';

import { lookupErrorCode } from '@bslt/contract';

import { complianceErrors } from './errors';

describe('complianceErrors', () => {
  it('registers compliance-prefixed error codes with expected HTTP statuses', () => {
    expect(lookupErrorCode(complianceErrors.DOCUMENT_TYPE_INVALID)?.status).toBe(400);
    expect(lookupErrorCode(complianceErrors.DOCUMENT_NOT_FOUND)?.status).toBe(404);
    expect(lookupErrorCode(complianceErrors.DATA_EXPORT_ALREADY_PENDING)?.status).toBe(409);
    expect(lookupErrorCode(complianceErrors.LEGAL_HOLD_ACTIVE)?.status).toBe(409);
    expect(lookupErrorCode(complianceErrors.JURISDICTION_UNAVAILABLE)?.status).toBe(403);
    expect(lookupErrorCode('compliance.NONEXISTENT')).toBeUndefined();

    for (const code of Object.values(complianceErrors)) {
      expect(code).toMatch(/^compliance\./u);
      expect(lookupErrorCode(code)?.status).toBeGreaterThanOrEqual(400);
    }
  });
});
