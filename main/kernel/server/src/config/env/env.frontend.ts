// main/kernel/server/src/config/env/env.frontend.ts
/**
 * Frontend Environment Configuration
 *
 * Frontend env interface and validation schema.
 *
 * @module config/env.frontend
 */

import { object, optional, string } from '@bslt/schema';

import { httpUrlSchema } from './env.base';

import type { Schema } from '@bslt/schema';

// ============================================================================
// Env Interface
// ============================================================================

/** Frontend environment variables */
export interface FrontendEnv {
  VITE_API_URL?: string | undefined;
  VITE_APP_NAME?: string | undefined;
  VITE_STRIPE_PUBLISHABLE_KEY?: string | undefined;
}

// ============================================================================
// Env Schema
// ============================================================================

export const FrontendEnvSchema: Schema<FrontendEnv> = object(
  {
    VITE_API_URL: optional(httpUrlSchema('VITE_API_URL')),
    VITE_APP_NAME: optional(string({ label: 'VITE_APP_NAME' })),
    VITE_STRIPE_PUBLISHABLE_KEY: optional(string({ label: 'VITE_STRIPE_PUBLISHABLE_KEY' })),
  },
  { unknownKeys: 'strip' },
);
