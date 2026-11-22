// main/kernel/server/src/config/env/env.base.ts
/**
 * Base Environment Configuration
 *
 * Constants, trueFalseSchema utility, and BaseEnv.
 * trueFalseSchema is exported for reuse by domain env files.
 *
 * @module config/env.base
 */

import { defaulted, enumOf, number, object, optional, string, transform } from '@bslt/schema';

import type { Schema } from '@bslt/schema';

// ============================================================================
// Constants
// ============================================================================

const HTTP_URL_PATTERN = /^https?:\/\/.+/u;

const nodeEnvSchema = enumOf(['development', 'production', 'test'] as const, 'NODE_ENV');
export const trueFalseSchema = enumOf(['true', 'false'] as const, 'boolean flag');

export function httpUrlSchema(label: string): Schema<string> {
  return string({
    label,
    pattern: HTTP_URL_PATTERN,
    patternMessage: `${label} must be a valid URL`,
  });
}

// ============================================================================
// Base
// ============================================================================

/** Base environment variables */
export interface BaseEnv {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  APP_NAME?: string | undefined;
  APP_PUBLIC_URL?: string | undefined;
}

export const BaseEnvSchema: Schema<BaseEnv> = transform(
  object(
    {
      NODE_ENV: defaulted(nodeEnvSchema, 'development'),
      PORT: defaulted(number({ coerce: true, label: 'PORT' }), 8080),
      APP_NAME: optional(string({ label: 'APP_NAME' })),
      APP_PUBLIC_URL: optional(httpUrlSchema('APP_PUBLIC_URL')),
      NEXT_PUBLIC_APP_URL: optional(httpUrlSchema('APP_PUBLIC_URL')),
    },
    { unknownKeys: 'strip' },
  ),
  ({ NEXT_PUBLIC_APP_URL, APP_PUBLIC_URL, ...rest }) => {
    const resolvedPublicUrl = APP_PUBLIC_URL ?? NEXT_PUBLIC_APP_URL;
    return {
      ...rest,
      ...(resolvedPublicUrl !== undefined ? { APP_PUBLIC_URL: resolvedPublicUrl } : {}),
    };
  },
);
