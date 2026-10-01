// Core edition: only account and security routes are composed here.
import { apiKeysRoutes } from './api-keys';
import { authRoutes } from './auth';
import { dataExportRoutes } from './compliance/data-export';
import { legalRoutes } from './compliance/legal';
import { consentRoutes } from './consent';
import { notificationRoutes } from './notifications';
import { userRoutes } from './users';
import type { RouteMap } from '@bslt/server-system/http';
export interface CoreRouteModuleRegistration {
  module: string;
  routes: RouteMap;
}
export const coreRouteModuleRegistrations: readonly CoreRouteModuleRegistration[] = [
  { module: 'auth', routes: authRoutes },
  { module: 'api-keys', routes: apiKeysRoutes },
  { module: 'users', routes: userRoutes },
  { module: 'notifications', routes: notificationRoutes },
  { module: 'legal', routes: legalRoutes },
  { module: 'consent', routes: consentRoutes },
  { module: 'data-export', routes: dataExportRoutes },
];
