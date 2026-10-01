// main/server/system/src/config/services/email.ts
import { SMTP_DEFAULTS } from '@bslt/shared/constants';
import { getInt } from '@bslt/shared/helpers';

import type { EmailConfig, FullEnv, SmtpConfig } from '@bslt/shared/system/config';

const PLACEHOLDER_SMTP_HOSTS = new Set(['localhost', '127.0.0.1', 'smtp.example.com']);
const PLACEHOLDER_EMAIL_DOMAINS = new Set(['example.com', 'example.org', 'example.net']);

/**
 * Loads raw SMTP transport settings from environment variables.
 *
 * @param env - Environment variable map
 * @returns SMTP configuration for nodemailer transport
 */
export function loadSmtpConfig(env: FullEnv): SmtpConfig {
  const config: SmtpConfig = {
    host: env.SMTP_HOST ?? 'localhost',
    port: getInt(env.SMTP_PORT != null ? String(env.SMTP_PORT) : undefined, SMTP_DEFAULTS.PORT),
    secure: env.SMTP_SECURE === 'true',
    connectionTimeout: getInt(
      env.SMTP_CONNECTION_TIMEOUT != null ? String(env.SMTP_CONNECTION_TIMEOUT) : undefined,
      SMTP_DEFAULTS.CONNECTION_TIMEOUT_MS,
    ),
    socketTimeout: getInt(
      env.SMTP_SOCKET_TIMEOUT != null ? String(env.SMTP_SOCKET_TIMEOUT) : undefined,
      SMTP_DEFAULTS.SOCKET_TIMEOUT_MS,
    ),
  };

  if (
    env.SMTP_USER != null &&
    env.SMTP_USER !== '' &&
    env.SMTP_PASS != null &&
    env.SMTP_PASS !== ''
  ) {
    config.auth = { user: env.SMTP_USER, pass: env.SMTP_PASS };
  }

  return config;
}

/**
 * Load Email Service Configuration.
 *
 * **Provider Modes**:
 * - **Console**: "Dry run" mode. Logs email content to stdout. Useful for local dev.
 * - **SMTP**: Real email delivery via standard mail servers (SendGrid, SES, Postmark, etc).
 * @param env - Environment variable map
 * @returns Complete email configuration
 *
 * @example
 * ```typescript
 * const emailConfig = loadEmail(process.env);
 * // emailConfig.provider === 'console' in development
 * // emailConfig.provider === 'smtp' in production
 * ```
 */
export function loadEmailConfig(env: FullEnv, appName = 'Your App'): EmailConfig {
  const provider = env.EMAIL_PROVIDER;

  const smtp = loadSmtpConfig(env);

  const config: EmailConfig = {
    provider,
    // SMTP settings - used if provider is 'smtp'
    smtp: {
      ...smtp,
      // Ensure auth object is at least an empty structure for type safety in some drivers
      auth: smtp.auth ?? { user: '', pass: '' },
    },

    // Global "From" identity — the sender name defaults to the configured app
    // name (not a literal 'Your App') when EMAIL_FROM_NAME is unset.
    from: {
      name: env.EMAIL_FROM_NAME ?? appName,
      address: env.EMAIL_FROM_ADDRESS ?? 'noreply@example.com',
    },

    // Standard Enterprise feature: separate reply-to
    replyTo: env.EMAIL_REPLY_TO ?? env.EMAIL_FROM_ADDRESS ?? 'noreply@example.com',
  };

  // API-based provider placeholder (e.g., Resend, Postmark)
  if (env.EMAIL_API_KEY !== undefined) {
    config.apiKey = env.EMAIL_API_KEY;
  }

  return config;
}

export function validateEmailConfig(config: EmailConfig, isProd: boolean): string[] {
  if (!isProd) return [];

  const errors: string[] = [];

  if (config.provider === 'console') {
    errors.push(
      'Email: EMAIL_PROVIDER=console is not allowed in production. Configure SMTP or run in a non-production environment.',
    );
  }

  if (config.provider === 'smtp') {
    const smtpHost = config.smtp.host.trim().toLowerCase();
    if (smtpHost === '' || PLACEHOLDER_SMTP_HOSTS.has(smtpHost)) {
      errors.push('Email: SMTP_HOST must be set to a real SMTP host in production.');
    }
  }

  const fromDomain = config.from.address.split('@')[1]?.trim().toLowerCase();
  if (fromDomain === undefined || PLACEHOLDER_EMAIL_DOMAINS.has(fromDomain)) {
    errors.push('Email: EMAIL_FROM_ADDRESS must use your app domain in production.');
  }

  return errors;
}

export const DEFAULT_SMTP_CONFIG: SmtpConfig = {
  host: 'localhost',
  port: SMTP_DEFAULTS.PORT,
  secure: false,
  connectionTimeout: SMTP_DEFAULTS.CONNECTION_TIMEOUT_MS,
  socketTimeout: SMTP_DEFAULTS.SOCKET_TIMEOUT_MS,
};
