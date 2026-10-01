// main/apps/server/src/bootstrap/context.ts

import {
  type BillingNotifier,
  type EmailService,
  type ErrorTracker,
  type NotificationService,
  type ReplyContext,
  type RequestInfo,
  type StorageClient,
} from '@bslt/shared/contracts';
import {
  BadRequestError,
  ForbiddenError,
  type HealthCheckCache,
  type HealthCheckQueue,
  type Logger,
} from '@bslt/shared/system';

import type { AuthEmailTemplates } from '@bslt/core/auth';
import type {
  DbClient,
  QueueStore,
  Repositories,
  ServerSearchProvider,
  SessionContext,
  WriteService,
} from '@bslt/db';
import type { SmsProvider } from '@bslt/shared/comms';
import type { BillingService } from '@bslt/shared/core';
import type { SubscriptionManager } from '@bslt/shared/db';
import type { AppConfig } from '@bslt/shared/system/config';
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';

// ============================================================================
// Bootstrap Phase Contexts
// ============================================================================

export interface ContextualizedResources {
  db: DbClient;
  repos: Repositories;
}

export interface PlatformContext {
  readonly config: AppConfig;
  readonly pubsub: SubscriptionManager;
  readonly cache: HealthCheckCache;
  readonly errorTracker: ErrorTracker;
  readonly log: Logger;
}

export interface DataContext extends PlatformContext {
  readonly db: DbClient;
  readonly repos: Repositories;
  readonly search: ServerSearchProvider;
  readonly queue: HealthCheckQueue;
  readonly queueStore: QueueStore;
  readonly write: WriteService;
  contextualize(session: SessionContext): ContextualizedResources;
}

export interface InfraContext extends DataContext {
  readonly email?: EmailService | undefined;
  readonly storage?: StorageClient | undefined;
  readonly notifications?: NotificationService | undefined;
  readonly billing?: BillingService | undefined;
  readonly billingNotifier?: BillingNotifier | undefined;
  readonly emailTemplates: AuthEmailTemplates;
  readonly sms?: SmsProvider | undefined;
}

// ============================================================================
// Fastify Request/Reply Extensions
// ============================================================================

/**
 * Fastify-specific reply augmentation.
 *
 * Structurally identical to `ReplyContext` from `@bslt/shared`,
 * but kept as a distinct type alias for Fastify's `declare module` augmentation.
 */
export type ReplyWithCookies = ReplyContext;

/**
 * Fastify-specific request augmentation.
 *
 * Uses `RequestInfo` from `@bslt/shared` for client metadata.
 * Extends the framework-agnostic `RequestContext` with Fastify-specific
 * properties (ip, requestStart, context).
 */
export interface RequestWithCookies {
  cookies: Record<string, string | undefined>;
  headers: {
    authorization?: string | undefined;
    'user-agent'?: string | undefined;
    [key: string]: string | string[] | undefined;
  };
  /** Client IP address (from Fastify's request.ip, respects trustProxy) */
  ip?: string | undefined;
  user?: { userId: string; email: string; role: string; tenantId?: string } | undefined;
  /** Request info extracted by middleware (IP address, user agent) */
  requestInfo: RequestInfo;
  /** Start time for request timing in development (bigint from process.hrtime.bigint()) */
  requestStart?: bigint | undefined;
  /** Application Context (Hybrid Pattern) - Available on request via hook */
  context?: AppContext | undefined;
}

// ============================================================================
// Service Container Interface (Composition Root)
// ============================================================================

/**
 * Service Container Interface
 *
 * Defines the contract for the application's dependency injection container.
 * The App class implements this interface, providing a single source of truth
 * for all infrastructure services.
 */
export interface IServiceContainer {
  /** Application configuration */
  readonly config: AppConfig;

  /** Database client (raw SQL query builder) */
  readonly db: DbClient;

  /** Database repositories */
  readonly repos: Repositories;

  /** Email service for sending notifications (optional — injected at app layer) */
  readonly email?: EmailService | undefined;

  /** Storage provider for file uploads (optional — injected at app layer) */
  readonly storage?: StorageClient | undefined;

  /** Pub/sub manager for real-time subscriptions */
  readonly pubsub: SubscriptionManager;

  /** Cache health check adapter */
  readonly cache: HealthCheckCache;

  /** Billing provider for payments/subscriptions (optional — injected at app layer) */
  readonly billing?: BillingService | undefined;

  /** Dispatches dunning emails/in-app alerts from webhooks (optional — injected at app layer) */
  readonly billingNotifier?: BillingNotifier | undefined;

  /** Notification service for push/email (optional — injected at app layer) */
  readonly notifications?: NotificationService | undefined;

  /** Background job queue (health check interface) */
  readonly queue: HealthCheckQueue;

  /** Queue store (for task cleanup) */
  readonly queueStore: QueueStore;

  /** Unified write service (Chet-stack pattern) */
  readonly write: WriteService;

  /** Server-side search provider */
  readonly search: ServerSearchProvider;

  /** Auth email templates (used by auth package handlers) */
  readonly emailTemplates: AuthEmailTemplates;

  /** SMS provider for phone verification (optional — gracefully degrades) */
  readonly sms?: SmsProvider | undefined;

  /** Error tracking and observability */
  readonly errorTracker: ErrorTracker;

  /**
   * Create a contextualized version of the service container for Row-Level Security.
   */
  contextualize(session: SessionContext): AppContext;
}

/**
 * Interface for services that provide an AppContext
 */
export interface HasContext {
  readonly context: AppContext;
}

const TENANT_ID_HEADER = 'x-tenant-id';

// ============================================================================
// App Context (Handler Interface)
// ============================================================================

/**
 * Application context passed to all handlers.
 *
 * Extends `IServiceContainer` with runtime-specific dependencies (logger).
 * Structurally satisfies `BaseContext` from `@bslt/shared` --
 * verified at compile time via `AppContextSatisfiesBaseContext` below.
 *
 * Package handlers accept `BaseContext` (or module-specific extensions);
 * the server passes `AppContext` which structurally satisfies all of them
 * -- no casting needed.
 *
 * Note: Cannot use `extends BaseContext` directly because TypeScript's
 * interface `extends` requires identically-typed properties across parents.
 * `IServiceContainer.db` is `DbClient` while `BaseContext.db` is `unknown`.
 * These are compatible (DbClient assignable to unknown) but not identical.
 *
 * @see {@link BaseContext} from `@bslt/shared`
 */
export interface AppContext extends IServiceContainer {
  /** Logger instance (from Fastify's Pino logger) */
  log: FastifyBaseLogger;
}

/**
 * Compile-time verification: AppContext structurally satisfies BaseContext.
 *
 * If `AppContext` ever stops satisfying `BaseContext` (e.g., a required
 * property is removed or becomes incompatible), this line produces:
 * "Type 'AppContext' does not satisfy the constraint 'BaseContext'."
 *
 * @internal
 */

function readSingleHeader(
  headers: RequestWithCookies['headers'],
  headerName: string,
): string | undefined {
  const value = headers[headerName];
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return undefined;

  const trimmed = raw.trim();
  return trimmed !== '' ? trimmed : undefined;
}

function normalizeTenantId(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed !== '' ? trimmed : undefined;
}

function resolveRequestedTenantId(request: RequestWithCookies): string | undefined {
  const tenantHeader = readSingleHeader(request.headers, TENANT_ID_HEADER);

  const tokenTenantId = normalizeTenantId(request.user?.tenantId);
  const headerTenantId = tenantHeader;

  if (
    headerTenantId !== undefined &&
    tokenTenantId !== undefined &&
    headerTenantId !== tokenTenantId
  ) {
    throw new BadRequestError('Tenant header does not match token tenant', 'TENANT_MISMATCH');
  }

  return headerTenantId ?? tokenTenantId;
}

/**
 * Fastify preHandler hook to contextualize the application context for Row-Level Security.
 *
 * If a user is authenticated (req.user is present), it creates a scoped context with
 * the user's ID. A tenant scope is only attached after the requested tenant has been
 * verified against the user's memberships; raw tenant headers are never
 * trusted directly.
 */
export async function contextualizeRequest(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const request = req as FastifyRequest & Partial<RequestWithCookies>;

  if (!request.context || !request.user) {
    return;
  }

  const userId = request.user.userId;
  const role = request.user.role;
  const tenantId = resolveRequestedTenantId(request as RequestWithCookies);

  request.context = request.context.contextualize({ userId, role });

  if (tenantId === undefined) {
    return;
  }

  const membership = await request.context.repos.memberships.findByTenantAndUser(tenantId, userId);
  if (membership === null) {
    throw new ForbiddenError(
      'You are not a member of the requested tenant',
      'TENANT_MEMBERSHIP_REQUIRED',
    );
  }

  request.context = request.context.contextualize({ userId, role, tenantId });
}
