// main/modules/audit/module.ts
import { defineModule } from '@bslt/contract';

import { auditEndpoints, auditJobs } from './contract';

export const auditModule = defineModule({
  id: 'audit',
  summary:
    'Append-only audit stream, security event console, and user activity timeline projection.',
  status: 'stable',
  dependsOn: [],
  endpoints: auditEndpoints,
  events: {},
  jobs: auditJobs,
  tables: ['audit_log', 'audit_activity'],
});
