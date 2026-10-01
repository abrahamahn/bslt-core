// main/shared/src/modules/system/config/env.frontend.ts
/**
 * Frontend Environment Configuration
 *
 * Frontend env interface and validation schema.
 *
 * @module config/env.frontend
 */

import { createSchema, parseObject, parseOptional, parseString } from '../../../schema';

import type { Schema } from '../../../schema';

// ============================================================================
// Env Interface
// ============================================================================

/** Frontend environment variables */
export interface FrontendEnv {
  VITE_ENABLE_ACTIVITY_FEED?: string | undefined;
  VITE_ENABLE_ADVANCED_ADMIN?: string | undefined;
  VITE_ENABLE_BILLING?: string | undefined;
  VITE_API_URL?: string | undefined;
  VITE_APP_NAME?: string | undefined;
  VITE_STRIPE_PUBLISHABLE_KEY?: string | undefined;
}

// ============================================================================
// Env Schema
// ============================================================================

export const FrontendEnvSchema: Schema<FrontendEnv> = createSchema<FrontendEnv>((data: unknown) => {
  const obj = parseObject(data, 'FrontendEnv');
  return {
    VITE_ENABLE_ACTIVITY_FEED: parseOptional(obj['VITE_ENABLE_ACTIVITY_FEED'], (v: unknown) =>
      parseString(v, 'VITE_ENABLE_ACTIVITY_FEED'),
    ),
    VITE_ENABLE_ADVANCED_ADMIN: parseOptional(obj['VITE_ENABLE_ADVANCED_ADMIN'], (v: unknown) =>
      parseString(v, 'VITE_ENABLE_ADVANCED_ADMIN'),
    ),
    VITE_ENABLE_BILLING: parseOptional(obj['VITE_ENABLE_BILLING'], (v: unknown) =>
      parseString(v, 'VITE_ENABLE_BILLING'),
    ),
    VITE_API_URL: parseOptional(obj['VITE_API_URL'], (v: unknown) =>
      parseString(v, 'VITE_API_URL', { url: true }),
    ),
    VITE_APP_NAME: parseOptional(obj['VITE_APP_NAME'], (v: unknown) =>
      parseString(v, 'VITE_APP_NAME'),
    ),
    VITE_STRIPE_PUBLISHABLE_KEY: parseOptional(obj['VITE_STRIPE_PUBLISHABLE_KEY'], (v: unknown) =>
      parseString(v, 'VITE_STRIPE_PUBLISHABLE_KEY'),
    ),
  };
});
