// main/server/core/src/notifications/types.ts
import {
  type BaseContext,
  type NotificationService,
  type RequestContext,
} from '@bslt/shared/contracts';
import { type Logger as ServerLogger } from '@bslt/shared/system';

import type { DbClient } from '@bslt/db/client';
import type { Repositories } from '@bslt/db/factory';

// ============================================================================
// Context Interfaces
// ============================================================================

/**
 * Notification module dependencies.
 * Provided by the server composition root when wiring handlers.
 *
 * Extends `BaseContext` from contracts. This matches the minimal subset
 * of AppContext that notification handlers require, keeping the package
 * decoupled from the full server context.
 */
export interface NotificationModuleDeps extends BaseContext {
  /** Database client for direct SQL queries */
  readonly db: DbClient;
  /** Repository container for typed data access */
  readonly repos: Repositories;
  /** Logger instance for structured logging */
  readonly log: ServerLogger;
  /**
   * Push notification provider service (optional — injected by the server
   * composition root). Enables browser Web Push delivery when configured.
   */
  readonly notifications?: NotificationService | undefined;
}

// ============================================================================
// Request Interface (Transition Alias)
// ============================================================================

/**
 * Request interface for notification handlers.
 *
 * Transition alias for `RequestContext` from contracts.
 * Existing code importing `NotificationRequest` from this module continues
 * working. New code should import `RequestContext` from `@bslt/shared`.
 */
export type NotificationRequest = RequestContext;
