// main/modules/devtools/contract/schemas.ts
import {
  array,
  boolean,
  enumOf,
  nullable,
  number,
  object,
  optional,
  string,
  type Infer,
} from '@bslt/schema';

export const ADMIN_ROUTE_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
] as const;

export const adminRouteMethodSchema = enumOf(ADMIN_ROUTE_METHODS);
export type AdminRouteMethod = Infer<typeof adminRouteMethodSchema>;

export const routeManifestEntrySchema = object({
  path: string({ label: 'path' }),
  method: adminRouteMethodSchema,
  isPublic: boolean({ label: 'isPublic' }),
  roles: array(string({ label: 'role' })),
  hasSchema: boolean({ label: 'hasSchema' }),
  module: string({ label: 'module' }),
  deprecated: optional(boolean({ label: 'deprecated' })),
  summary: optional(string({ label: 'summary' })),
  tags: optional(array(string({ label: 'tag' }))),
});
export type AdminRouteManifestEntry = Infer<typeof routeManifestEntrySchema>;

export const routeManifestResponseSchema = object({
  routes: array(routeManifestEntrySchema),
  count: number({ label: 'count', int: true, min: 0 }),
});
export type RouteManifestResponse = Infer<typeof routeManifestResponseSchema>;

const devEmailItemSchema = object({
  id: string({ label: 'id' }),
  to: array(string({ label: 'recipient' })),
  subject: string({ label: 'subject' }),
  text: nullable(string({ label: 'text' })),
  html: nullable(string({ label: 'html' })),
  links: array(string({ label: 'link' })),
  sentAt: string({ label: 'sentAt' }),
});
export type DevEmailItem = Infer<typeof devEmailItemSchema>;

export const devEmailInboxResponseSchema = object({
  emails: array(devEmailItemSchema),
  count: number({ label: 'count', int: true, min: 0 }),
});
export type DevEmailInboxResponse = Infer<typeof devEmailInboxResponseSchema>;

export const clearDevEmailsResponseSchema = object({
  cleared: number({ label: 'cleared', int: true, min: 0 }),
});
export type ClearDevEmailsResponse = Infer<typeof clearDevEmailsResponseSchema>;

export const devtoolsEnvSchema = object({
  NODE_ENV: optional(string({ label: 'NODE_ENV' })),
});
