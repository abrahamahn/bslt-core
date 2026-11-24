// main/modules/devtools/contract/endpoints.ts
import { emptyBodySchema, endpoint } from '@bslt/contract';

import {
  clearDevEmailsResponseSchema,
  devEmailInboxResponseSchema,
  routeManifestResponseSchema,
} from './schemas';

export const devtoolsEndpoints = {
  getRouteManifest: endpoint({
    method: 'GET',
    path: '/api/admin/routes',
    auth: 'admin',
    response: routeManifestResponseSchema,
    summary: 'Get registered route manifest',
  }),
  listDevEmails: endpoint({
    method: 'GET',
    path: '/api/devtools/emails',
    auth: 'public',
    response: devEmailInboxResponseSchema,
    summary: 'List outbound emails captured in the local development inbox',
  }),
  clearDevEmails: endpoint({
    method: 'POST',
    path: '/api/devtools/emails/clear',
    auth: 'public',
    body: emptyBodySchema,
    response: clearDevEmailsResponseSchema,
    invalidates: ['listDevEmails'],
    summary: 'Clear captured emails from the local development inbox',
  }),
} as const;
