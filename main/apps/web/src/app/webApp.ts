// main/apps/web/src/app/webApp.ts
/**
 * Single web platform composition instance (`createWebApp`) aggregating installed
 * `WebModule` bindings from `bslt.config.ts` and `appFrame`.
 */

import { createWebApp } from '@bslt/web-platform';

import {
  devOnlyModules,
  devOnlyWebModules,
  installedModules,
  installedWebModules,
} from '../generated/modules';

import { appFrame } from './frame';

export const webApp = createWebApp({
  modules: [...installedWebModules, ...devOnlyWebModules],
  installedManifests: [...installedModules, ...devOnlyModules],
  frame: appFrame,
});
