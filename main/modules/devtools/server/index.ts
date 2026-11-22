// main/modules/devtools/server/index.ts
import { implementServer } from '@bslt/server-system/module';

import { devtoolsModule } from '../module';

import { buildRouteManifest } from './service';

import type { RouteManifestResponse } from '../contract';

type DevtoolsService = {
  readonly readManifest: () => RouteManifestResponse;
};

export const devtoolsServer = implementServer(devtoolsModule, {
  create: (): DevtoolsService => ({
    readManifest: () => buildRouteManifest(),
  }),
  handlers: {
    getRouteManifest: (_input, _req, s) => Promise.resolve(s.readManifest()),
  },
});
