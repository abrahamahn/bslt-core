// main/shared/src/contracts/context.ts

import type {
  EmailService,
  ErrorTracker,
  NotificationService,
  StorageService,
} from './contract.ports';
import type { CacheProvider, Logger } from '../modules/system';

/** Minimal authenticated user information attached to request context. */
export interface AuthenticatedUser {
  userId: string;
  role: string;
  tenantId?: string | undefined;
  email?: string | undefined;
}

/** Basic network and client information from the request. */
export interface RequestInfo {
  /** Resolved client IP address */
  ip: string;
  /** Alias for ip */
  ipAddress?: string | undefined;
  /** Client user agent string */
  userAgent?: string | undefined;
}

/**
 * Shared request context.
 * Provides access to the authenticated user and request metadata.
 */
export interface RequestContext {
  /** The acting user, if authenticated */
  user?: AuthenticatedUser | undefined;
  /** Basic request information (IP, User Agent) */
  requestInfo: RequestInfo;
  /** Unique ID for tracing across services */
  correlationId?: string | undefined;
  /** Raw request headers */
  headers?: Record<string, string | string[] | undefined> | undefined;
  /** Parsed request cookies */
  cookies?: Record<string, string | undefined> | undefined;
}

/** Minimal interface for manipulating response state (cookies). */
export interface ReplyContext {
  setCookie(name: string, value: string, opts?: Record<string, unknown>): void;
  clearCookie(name: string, opts?: Record<string, unknown>): void;
}

/** Context capability: Email Service availability. */
export interface HasEmail {
  email?: EmailService | undefined;
}

/** Context capability: Storage Service availability. */
export interface HasStorage {
  storage?:
    | StorageService
    | {
        upload(key: string, data: Uint8Array | string, contentType: string): Promise<string>;
        delete(key: string): Promise<void>;
        getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
      }
    | undefined;
}

/** Context capability: Notification Service availability. */
export interface HasNotifications {
  notifications?: NotificationService | undefined;
}

/** Context capability: Billing Service availability. */
export interface HasBilling {
  billing?: unknown;
}

/** Context capability: Cache Service availability. */
export interface HasCache {
  cache?: CacheProvider | undefined;
}

/** Context capability: Pub/Sub Service availability. */
export interface HasPubSub {
  pubsub?: unknown;
}

/** Context capability: Background Queue availability. */
export interface HasQueue {
  queue?: unknown;
}

/**
 * Base platform context.
 * Aggregates all system services and configurations into a single injectable object.
 */
export interface BaseContext
  extends HasEmail, HasStorage, HasNotifications, HasBilling, HasCache, HasPubSub, HasQueue {
  /** System configuration access */
  config: unknown;
  /** Database instance/client */
  db: unknown;
  /** Unified repository access layer */
  repos: unknown;
  /** Context-aware logger */
  log: Logger;
  /** Error tracking service (e.g. Sentry) */
  errorTracker?: ErrorTracker | undefined;
  /** Return a new context scoped to a specific session/user */
  contextualize(session: { userId?: string; role?: string; tenantId?: string }): BaseContext;
}
