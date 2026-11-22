// main/modules/devtools/contract/endpoints.ts
import { endpoint } from '@bslt/contract';

import { routeManifestResponseSchema } from './schemas';

export const devtoolsEndpoints = {
  getRouteManifest: endpoint({
    method: 'GET',
    path: '/api/admin/routes',
    auth: 'admin',
    response: routeManifestResponseSchema,
    summary: 'Get registered route manifest',
  }),
} as const;
