// main/apps/server/src/http/index.ts
/**
 * HTTP Layer Barrel
 *
 * Re-exports from sibling modules:
 * - file-server: Static file serving configuration
 * - router: app route composition
 */

export { registerFileServer } from './file-server';
export { createAppAuthGuardFactory, registerRoutes } from './router';
export { systemRoutes } from './system-routes';
export { registerRouteMap } from '@bslt/server-system/http';
export type { AuthGuardFactory } from '@bslt/server-system/http';
