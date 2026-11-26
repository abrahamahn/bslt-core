// main/modules/compliance/module.test.ts
import { describe, expect, it } from 'vitest';

import { complianceModule } from './module';

describe('complianceModule', () => {
  it('registers compliance tables, identity dependency, endpoints, events, and jobs', () => {
    expect(complianceModule.id).toBe('compliance');
    expect(complianceModule.dependsOn.map((dep) => dep.id)).toContain('identity');
    expect(complianceModule.tables).toEqual([
      'compliance_age_assurance_checks',
      'compliance_consents',
      'compliance_data_requests',
      'compliance_jurisdiction_rules',
      'compliance_legal_documents',
      'compliance_legal_holds',
      'compliance_retention_policies',
    ]);
    expect(Object.keys(complianceModule.endpoints).length).toBeGreaterThan(0);
    expect(Object.keys(complianceModule.events).length).toBeGreaterThan(0);
    expect(Object.keys(complianceModule.jobs)).toContain('cleanupExpiredExports');
  });
});
