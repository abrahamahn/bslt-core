// main/kernel/comms/src/notifications/providers/types.ts
/**
 * Push Notification Provider Types
 *
 * Interfaces for implementing push notification providers.
 * Providers handle the actual sending of push notifications
 * to different push services (Web Push today; others via new adapters).
 */

interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: PushSubscriptionKeys;
}

interface NotificationAction {
  action: string;
  title: string;
  icon?: string | undefined;
}

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  image?: string;
  tag?: string;
  data?: Record<string, unknown>;
  actions?: NotificationAction[];
  requireInteraction?: boolean;
  renotify?: boolean;
  silent?: boolean;
  vibrate?: number[];
  timestamp?: number;
  url?: string;
}

export interface SendResult {
  success: boolean;
  subscriptionId: string;
  error?: string;
  statusCode?: number;
}

export interface BatchSendResult {
  total: number;
  successful: number;
  failed: number;
  results: SendResult[];
  expiredSubscriptions: string[];
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Push notification provider interface.
 *
 * Implementations handle the actual sending of push notifications
 * to different push services (Web Push today; others via new adapters).
 */
export interface PushNotificationProvider {
  /** Provider name for identification */
  readonly name: string;

  /**
   * Send a notification to a single subscription.
   *
   * @param subscription - Push subscription to send to
   * @param payload - Notification payload
   * @param options - Additional send options
   * @returns Send result indicating success or failure
   */
  send(
    subscription: PushSubscription,
    payload: NotificationPayload,
    options?: SendOptions,
  ): Promise<SendResult>;

  /**
   * Send notifications to multiple subscriptions.
   *
   * @param subscriptions - Array of subscriptions with their IDs
   * @param payload - Notification payload
   * @param options - Additional send options
   * @returns Batch send result with success/failure counts
   */
  sendBatch(
    subscriptions: SubscriptionWithId[],
    payload: NotificationPayload,
    options?: SendOptions,
  ): Promise<BatchSendResult>;

  /**
   * Check if the provider is properly configured.
   *
   * @returns true if provider is ready to send
   */
  isConfigured(): boolean;

  /**
   * Get the public key for client subscription (if applicable).
   *
   * @returns Public key string or undefined if not applicable
   */
  getPublicKey(): string | undefined;
}

// ============================================================================
// Supporting Types
// ============================================================================

/**
 * Subscription with associated ID for tracking.
 */
export interface SubscriptionWithId {
  /** Unique subscription ID */
  id: string;
  /** Push subscription data */
  subscription: PushSubscription;
}

/**
 * Options for sending notifications.
 */
export interface SendOptions {
  /** Time-to-live in seconds (how long push service should retry) */
  ttl?: number;
  /** Urgency level */
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  /** Topic for message collapsing */
  topic?: string;
}

/**
 * VAPID configuration for browser Web Push.
 */
export interface VapidConfig {
  /** VAPID public key (base64url) — also served to clients for subscription. */
  publicKey: string;
  /** VAPID private key (base64url) — kept server-side. */
  privateKey: string;
  /** Contact subject: a `mailto:` address or an `https:` URL. */
  subject: string;
}

// ============================================================================
// Factory Types
// ============================================================================

/**
 * Options for creating notification providers.
 */
export interface NotificationFactoryOptions {
  /** VAPID configuration for browser Web Push */
  vapid?: VapidConfig;
  /** Default TTL for notifications (seconds) */
  defaultTtl?: number;
}

/**
 * Notification service aggregating multiple providers.
 */
export interface NotificationProviderService {
  /**
   * Get the Web Push (VAPID) provider.
   *
   * @returns The Web Push provider if configured, undefined otherwise
   */
  getWebPushProvider(): PushNotificationProvider | undefined;

  /**
   * Check if any provider is configured.
   *
   * @returns true if at least one provider is ready to send
   */
  isConfigured(): boolean;
}
