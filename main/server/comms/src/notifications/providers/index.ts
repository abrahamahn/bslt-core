// main/server/comms/src/notifications/providers/index.ts
/**
 * Notification Infrastructure
 *
 * Push notification providers and factory.
 */

// Types
export type {
  NotificationFactoryOptions,
  NotificationProviderService,
  PushNotificationProvider,
  SendOptions,
  SubscriptionWithId,
  VapidConfig,
} from './types';

// Web Push (VAPID) provider
export { WebPushProvider, createWebPushProvider } from './web-push-provider';

// Factory
export {
  createNotificationProviderService,
  createNotificationProviderServiceFromEnv,
} from './factory';
