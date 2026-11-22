// main/kernel/server/src/config/env/env.queue.ts
/**
 * Queue Environment Configuration
 *
 * Queue types, env interface, and validation schema.
 * Merged from config/types/infra.ts (queue section) and config/env.ts.
 *
 * @module config/env.queue
 */

import { defaulted, enumOf, number, object } from '@bslt/schema';

import type { Schema } from '@bslt/schema';

// ============================================================================
// Types
// ============================================================================

type QueueProvider = 'local' | 'redis';

/**
 * Background job queue configuration.
 * Supports local polling or Redis-backed distributed workers.
 */
export interface QueueConfig {
  provider: QueueProvider;
  pollIntervalMs: number;
  concurrency: number;
  defaultMaxAttempts: number;
  backoffBaseMs: number;
  maxBackoffMs: number;
}

// ============================================================================
// Env Interface
// ============================================================================

/** Queue environment variables */
export interface QueueEnv {
  QUEUE_PROVIDER: 'local' | 'redis';
  QUEUE_POLL_INTERVAL_MS: number;
  QUEUE_CONCURRENCY: number;
  QUEUE_MAX_ATTEMPTS: number;
  QUEUE_BACKOFF_BASE_MS: number;
  QUEUE_MAX_BACKOFF_MS: number;
}

// ============================================================================
// Env Schema
// ============================================================================

export const QueueEnvSchema: Schema<QueueEnv> = object(
  {
    QUEUE_PROVIDER: defaulted(enumOf(['local', 'redis'] as const, 'QUEUE_PROVIDER'), 'local'),
    QUEUE_POLL_INTERVAL_MS: defaulted(
      number({ coerce: true, label: 'QUEUE_POLL_INTERVAL_MS' }),
      1000,
    ),
    QUEUE_CONCURRENCY: defaulted(number({ coerce: true, label: 'QUEUE_CONCURRENCY' }), 5),
    QUEUE_MAX_ATTEMPTS: defaulted(number({ coerce: true, label: 'QUEUE_MAX_ATTEMPTS' }), 3),
    QUEUE_BACKOFF_BASE_MS: defaulted(
      number({ coerce: true, label: 'QUEUE_BACKOFF_BASE_MS' }),
      1000,
    ),
    QUEUE_MAX_BACKOFF_MS: defaulted(
      number({ coerce: true, label: 'QUEUE_MAX_BACKOFF_MS' }),
      300000,
    ),
  },
  { unknownKeys: 'strip' },
);
