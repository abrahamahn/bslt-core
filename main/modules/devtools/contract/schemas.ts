// main/modules/devtools/contract/schemas.ts
import { array, boolean, enumOf, number, object, optional, string, type Infer } from '@bslt/schema';

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
