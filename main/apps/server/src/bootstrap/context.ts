// main/apps/server/src/bootstrap/context.ts

import {
  BadRequestError,
  ForbiddenError,
  type EmailService,
  type ErrorTracker,
  type NotificationService,
  type RequestInfo,
  type StorageClient,
  type SystemPort,
} from '@bslt/contract';

import { resolveActingOrg } from '../generated/modules';

import type { SmsProvider } from '@bslt/comms';
import type { DbClient, QueueStore, ServerSearchProvider, SessionContext } from '@bslt/db';
import type { AuthEmailTemplates, authGuardReposFromDb } from '@bslt/identity/server';
import type { SubscriptionManager } from '@bslt/realtime';
import type { AppConfig } from '@bslt/server-system/config';
import type { HttpServerReply, HttpServerRequest } from '@bslt/server-system/http';
import type { Logger } from '@bslt/server-system/logger';
import type { KernelServices } from '@bslt/server-system/module';
import type { HealthCheckCache, HealthCheckQueue } from '@bslt/server-system/runtime';

// ============================================================================
// Bootstrap Phase Contexts
// ============================================================================

type AppRepositories = ReturnType<typeof authGuardReposFromDb>;

interface ContextualizedResources {
  db: DbClient;
  repos: AppRepositories;
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
  readonly repos: AppRepositories;
  readonly search: ServerSearchProvider;
  readonly queue: HealthCheckQueue;
  readonly queueStore: QueueStore;
  contextualize(session: SessionContext): ContextualizedResources;
}

export interface InfraContext extends DataContext {
  readonly email?: EmailService | undefined;
  readonly storage?: StorageClient | undefined;
  readonly notifications?: NotificationService | undefined;
  readonly emailTemplates: AuthEmailTemplates;
  readonly sms?: SmsProvider | undefined;
}

/**
 * The external ports a caller of `buildApp` may replace: what the infra phase
 * (logger, cache stats, error tracker) and the comms phase (email, templates,
 * storage, push, SMS) would otherwise compose. Production passes none.
 * A key that is present wins, `undefined` included, so a test can also run
 * without a port (`{ storage: undefined }`).
 */
export interface AppPorts {
  readonly log?: Logger;
  readonly cache?: HealthCheckCache;
  readonly errorTracker?: ErrorTracker;
  readonly email?: EmailService | undefined;
  readonly emailTemplates?: AuthEmailTemplates;
  readonly storage?: StorageClient | undefined;
  readonly notifications?: NotificationService | undefined;
  readonly sms?: SmsProvider | undefined;
}

// ============================================================================
// Fastify Request/Reply Extensions
// ============================================================================

/**
 * Fastify-specific request augmentation.
 *
 * Uses `RequestInfo` from `@bslt/contract` for client metadata.
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
  /** Verified active organization scope (populated by contextualizeRequest after membership check) */
  actingOrg?: { readonly orgId: string; readonly permissions: bigint } | undefined;
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
  readonly repos: AppRepositories;

  /**
   * The system port: the boot handles on the system pool (`bslt_worker`).
   * `db` and `repos` become a user-session scope on protected requests; these
   * never do. Only for the named flows that must reach beyond the caller's own
   * rows — each use bypasses the user's row-level security scope on purpose.
   */
  readonly system: SystemPort<DbClient, AppRepositories>;

  /** Email service for sending notifications (optional — injected at app layer) */
  readonly email?: EmailService | undefined;

  /** Storage provider for file uploads (optional — injected at app layer) */
  readonly storage?: StorageClient | undefined;

  /** Pub/sub manager for real-time subscriptions */
  readonly pubsub: SubscriptionManager;

  /** Cache health check adapter */
  readonly cache: HealthCheckCache;

  /** Notification service for push/email (optional — injected at app layer) */
  readonly notifications?: NotificationService | undefined;

  /** Background job queue (health check interface) */
  readonly queue: HealthCheckQueue;

  /** Queue store (for task cleanup) */
  readonly queueStore: QueueStore;

  /** Server-side search provider */
  readonly search: ServerSearchProvider;

  /** Auth email templates (used by auth package handlers) */
  readonly emailTemplates: AuthEmailTemplates;

  /** SMS provider for phone verification (optional — gracefully degrades) */
  readonly sms?: SmsProvider | undefined;

  /** Error tracking and observability */
  readonly errorTracker: ErrorTracker;

  /** Kernel outbox event publisher (optional on stubbed test containers) */
  readonly events?: KernelServices['events'] | undefined;

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
 * Structurally satisfies `BaseContext` from `@bslt/contract` --
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
 * @see {@link BaseContext} from `@bslt/contract`
 */
export interface AppContext extends IServiceContainer {
  /** Logger instance */
  log: Logger;
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
  req: HttpServerRequest,
  _reply: HttpServerReply,
): Promise<void> {
  const request = req as HttpServerRequest & Partial<RequestWithCookies>;

  if (!request.context || !request.user) {
    return;
  }

  const userId = request.user.userId;
  const role = request.user.role;
  const tenantId = resolveRequestedTenantId(request);

  request.context = request.context.contextualize({ userId, role });

  if (tenantId === undefined) {
    return;
  }

  const actingOrg = await resolveActingOrg(request.context.db, tenantId, userId);
  if (actingOrg === null) {
    throw new ForbiddenError(
      'You are not a member of the requested tenant',
      'TENANT_MEMBERSHIP_REQUIRED',
    );
  }

  request.context = request.context.contextualize({ userId, role, orgId: tenantId });
  request.actingOrg = actingOrg;
}
