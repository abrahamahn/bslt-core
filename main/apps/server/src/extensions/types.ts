import type { RouteMap } from '@bslt/server-system/http';
import type { AppContext } from '../bootstrap/context';
export interface FeatureWebhook {
  /** A single path segment; the host owns the /api/extensions/<id>/webhooks prefix. */
  name: string;
  signatureHeader: string;
  /** Must verify the exact raw bytes before parsing or changing persistent state. */
  handle(ctx: AppContext, payload: Buffer, signature: string): Promise<unknown>;
}
export interface InstalledServerFeature {
  id: string;
  routes: RouteMap;
  webhooks?: readonly FeatureWebhook[];
}
