// main/server/comms/src/notifications/providers/factory.ts
/**
 * Notification Provider Factory
 *
 * Creates and manages push notification providers based on configuration.
 * Web Push (VAPID) is the supported delivery path; additional providers can
 * be added by implementing the PushNotificationProvider interface.
 */

import { WebPushProvider } from './web-push-provider';

import type {
  NotificationFactoryOptions,
  NotificationProviderService,
  PushNotificationProvider,
} from './types';

// ============================================================================
// Notification Service Implementation
// ============================================================================

/**
 * Internal notification service implementation that aggregates providers.
 */
class NotificationProviderServiceImpl implements NotificationProviderService {
  private readonly webPushProvider: WebPushProvider | undefined;

  /**
   * Create a new notification provider service.
   *
   * @param webPushProvider - Optional Web Push (VAPID) provider instance
   */
  constructor(webPushProvider?: WebPushProvider) {
    this.webPushProvider = webPushProvider;
  }

  /**
   * Get the Web Push provider if configured.
   *
   * @returns The Web Push provider if configured and ready, undefined otherwise
   */
  getWebPushProvider(): PushNotificationProvider | undefined {
    return this.webPushProvider?.isConfigured() === true ? this.webPushProvider : undefined;
  }

  /**
   * Check if any provider is configured and ready.
   *
   * @returns true if at least one provider is configured
   */
  isConfigured(): boolean {
    return this.webPushProvider?.isConfigured() ?? false;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a notification service from explicit configuration.
 *
 * @param options - Provider configuration options
 * @returns NotificationProviderService instance
 *
 * @example
 * ```ts
 * const service = createNotificationProviderService({
 *   vapid: {
 *     publicKey: '...',
 *     privateKey: '...',
 *     subject: 'mailto:ops@example.com',
 *   },
 * });
 * ```
 */
export function createNotificationProviderService(
  options: NotificationFactoryOptions,
): NotificationProviderService {
  const webPushProvider = options.vapid != null ? new WebPushProvider(options.vapid) : undefined;
  return new NotificationProviderServiceImpl(webPushProvider);
}

/**
 * Create a notification service from environment variables.
 *
 * Reads configuration from environment:
 * - VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT: Web Push
 *
 * @param env - Environment variables object (defaults to process.env)
 * @returns NotificationProviderService instance
 *
 * @example
 * ```ts
 * const service = createNotificationProviderServiceFromEnv();
 *
 * if (service.isConfigured()) {
 *   const provider = service.getWebPushProvider();
 *   await provider?.send(subscription, payload);
 * }
 * ```
 */
export function createNotificationProviderServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): NotificationProviderService {
  // Web Push (VAPID). All three values are required; the provider reports
  // isConfigured() === false if any is missing.
  const webPushProvider = new WebPushProvider({
    publicKey: env['VAPID_PUBLIC_KEY'] ?? '',
    privateKey: env['VAPID_PRIVATE_KEY'] ?? '',
    subject: env['VAPID_SUBJECT'] ?? '',
  });

  return new NotificationProviderServiceImpl(webPushProvider);
}
