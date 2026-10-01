// main/server/core/src/api-keys/types.ts
/**
 * Handler context for the API Keys module.
 */

import type { Repositories } from '@bslt/db';
import type { Logger } from '@bslt/shared/system';

export interface ApiKeysAppContext {
  readonly log: Pick<Logger, 'error'>;
  readonly repos: Pick<Repositories, 'apiKeys'>;
}
