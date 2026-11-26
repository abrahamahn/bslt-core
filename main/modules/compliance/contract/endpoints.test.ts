// main/modules/compliance/contract/endpoints.test.ts
import { describe, expect, it } from 'vitest';

import { complianceEndpoints } from './endpoints';

describe('complianceEndpoints', () => {
  it('declares valid /api paths, auth policies, and public caching for current legal docs', () => {
    const entries = Object.values(complianceEndpoints);
    expect(entries.length).toBeGreaterThan(10);

    for (const ep of entries) {
      expect(ep.path.startsWith('/api/')).toBe(true);
    }

    expect(complianceEndpoints.getCurrentLegal.auth).toBe('public');
    expect(complianceEndpoints.getTosStatus.auth).toBe('user');
    expect(complianceEndpoints.publishLegal.auth).toBe('admin');
    expect(complianceEndpoints.publishLegal.requires).toContain('tos.accepted');
  });
});
