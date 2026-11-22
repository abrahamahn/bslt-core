// main/modules/compliance/module.ts
import { defineModule } from '@bslt/contract';
import { identityModule } from '@bslt/identity/module';

import { complianceEndpoints } from './contract/endpoints';
import { complianceEvents } from './contract/events';
import { complianceJobs } from './contract/jobs';
import { complianceEnvSchema } from './contract/schemas';

export const complianceModule = defineModule({
  id: 'compliance',
  summary:
    'Versioned legal documents, consent ledger, GDPR export/erasure orchestration, legal holds, retention policies, age assurance, and jurisdiction resolution.',
  status: 'stable',
  dependsOn: [identityModule],
  env: complianceEnvSchema,
  endpoints: complianceEndpoints,
  events: complianceEvents,
  jobs: complianceJobs,
  tables: [
    'compliance_age_assurance_checks',
    'compliance_consents',
    'compliance_data_requests',
    'compliance_jurisdiction_rules',
    'compliance_legal_documents',
    'compliance_legal_holds',
    'compliance_retention_policies',
  ],
});
