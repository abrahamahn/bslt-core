// main/kernel/server/src/config/env/env.email.ts
/**
 * Email Environment Configuration
 *
 * Email types, env interface, and validation schema.
 * Merged from config/types/services.ts (email section) and config/env.ts.
 *
 * @module config/env.email
 */

import { defaulted, enumOf, number, object, optional, string } from '@bslt/schema';

import { trueFalseSchema } from './env.base';

import type { Schema } from '@bslt/schema';

// ============================================================================
// Types
// ============================================================================

/**
 * SMTP connection settings.
 * Compatible with most email providers (Gmail, SendGrid, Mailgun, etc.)
 */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth?: {
    user: string;
    pass: string;
  };
  connectionTimeout: number;
  socketTimeout: number;
}

/**
 * Email service configuration.
 * Supports console logging (dev) or SMTP (production).
 */
export interface EmailConfig {
  provider: 'console' | 'smtp';
  smtp: SmtpConfig;
  apiKey?: string;
  from: {
    name: string;
    address: string;
  };
  replyTo: string;
}

// ============================================================================
// Env Interface
// ============================================================================

/** Email environment variables */
export interface EmailEnv {
  EMAIL_PROVIDER: 'console' | 'smtp';
  SMTP_HOST?: string | undefined;
  SMTP_PORT?: number | undefined;
  SMTP_SECURE?: 'true' | 'false' | undefined;
  SMTP_USER?: string | undefined;
  SMTP_PASS?: string | undefined;
  EMAIL_API_KEY?: string | undefined;
  EMAIL_FROM_NAME?: string | undefined;
  EMAIL_FROM_ADDRESS?: string | undefined;
  EMAIL_REPLY_TO?: string | undefined;
  SMTP_CONNECTION_TIMEOUT?: number | undefined;
  SMTP_SOCKET_TIMEOUT?: number | undefined;
}

// ============================================================================
// Env Schema
// ============================================================================

export const EmailEnvSchema: Schema<EmailEnv> = object(
  {
    EMAIL_PROVIDER: defaulted(enumOf(['console', 'smtp'] as const, 'EMAIL_PROVIDER'), 'console'),
    SMTP_HOST: optional(string({ label: 'SMTP_HOST' })),
    SMTP_PORT: optional(number({ coerce: true, label: 'SMTP_PORT' })),
    SMTP_SECURE: optional(trueFalseSchema),
    SMTP_USER: optional(string({ label: 'SMTP_USER' })),
    SMTP_PASS: optional(string({ label: 'SMTP_PASS' })),
    EMAIL_API_KEY: optional(string({ label: 'EMAIL_API_KEY' })),
    EMAIL_FROM_NAME: optional(string({ label: 'EMAIL_FROM_NAME' })),
    EMAIL_FROM_ADDRESS: optional(string({ label: 'EMAIL_FROM_ADDRESS' })),
    EMAIL_REPLY_TO: optional(string({ label: 'EMAIL_REPLY_TO' })),
    SMTP_CONNECTION_TIMEOUT: optional(number({ coerce: true, label: 'SMTP_CONNECTION_TIMEOUT' })),
    SMTP_SOCKET_TIMEOUT: optional(number({ coerce: true, label: 'SMTP_SOCKET_TIMEOUT' })),
  },
  { unknownKeys: 'strip' },
);
