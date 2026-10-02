import { installedFeatures } from './installed';
import type { InstalledServerFeature } from './types';
/** Packs inherit the app's JWT, account-status, RLS, and terms-acceptance guards. */
export function featureRouteModules(features: readonly InstalledServerFeature[] = installedFeatures) {
  return features.map(({ id, routes }) => {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) || !(routes instanceof Map))
      throw new Error(`Invalid feature route registration: ${id}`);
    for (const [route, definition] of routes) {
      if (!/^[a-zA-Z0-9:_-]+(?:\/[a-zA-Z0-9:_-]+)*$/.test(route) || definition.isPublic !== false)
        throw new Error(`Feature routes must be authenticated and relative: ${id}/${route}`);
    }
    return { module: `extension:${id}`, prefix: `/api/extensions/${id}`, routes };
  });
}
