import { installedFeatures } from './installed';
import type { InstalledServerFeature } from './types';
import type { AppContext } from '../bootstrap/context';
import type { FastifyInstance } from 'fastify';
/** Packs inherit the app's JWT, account-status, RLS, and terms-acceptance guards. */
export function featureRouteModules(
  features: readonly InstalledServerFeature[] = installedFeatures,
) {
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

/** Only explicitly installed handlers receive signed POST payloads; normal routes stay guarded. */
export function registerFeatureWebhooks(
  app: FastifyInstance,
  ctx: AppContext,
  features: readonly InstalledServerFeature[] = installedFeatures,
): void {
  featureRouteModules(features);
  const paths = new Set<string>();
  for (const { id, webhooks = [] } of features) {
    for (const webhook of webhooks) {
      if (
        !/^[a-z][a-z0-9-]*$/.test(webhook.name) ||
        !/^[a-z][a-z0-9-]*-signature$/.test(webhook.signatureHeader) ||
        typeof webhook.handle !== 'function'
      )
        throw new Error(`Invalid signed webhook registration: ${id}`);
      const url = `/api/extensions/${id}/webhooks/${webhook.name}`;
      if (paths.has(url)) throw new Error(`Duplicate feature webhook: ${url}`);
      paths.add(url);
      app.post(
        url,
        { bodyLimit: 1024 * 1024, config: { rawBody: true, extensionSignedWebhook: true } },
        async (request, reply) => {
          const signature = request.headers[webhook.signatureHeader];
          if (
            typeof signature !== 'string' ||
            signature.length > 4096 ||
            !Buffer.isBuffer(request.rawBody)
          )
            return reply.code(400).send({ error: 'A signed request body is required.' });
          return webhook.handle(ctx, request.rawBody, signature);
        },
      );
    }
  }
}
