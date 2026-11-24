// main/modules/devtools/module.ts
import { defineModule } from '@bslt/contract';

import { devtoolsEndpoints, devtoolsEnvSchema } from './contract';

export const devtoolsModule = defineModule({
  id: 'devtools',
  summary: 'Developer route manifest introspection and component showcase surfaces.',
  status: 'stable',
  dependsOn: [],
  endpoints: devtoolsEndpoints,
  events: {},
  jobs: {},
  tables: [],
  env: devtoolsEnvSchema,
});
