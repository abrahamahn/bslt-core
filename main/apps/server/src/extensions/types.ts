import type { RouteMap } from '@bslt/server-system/http';
export interface InstalledServerFeature {
  id: string;
  routes: RouteMap;
}
