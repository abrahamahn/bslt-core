// main/apps/server/src/bootstrap/phases/comms.ts

import { createNotificationProviderServiceFromEnv } from '@bslt/comms';
import { createEmailTemplates } from '@bslt/comms/email';
import { ConsoleEmailService } from '@bslt/comms/email/console';
import { SmtpEmailService } from '@bslt/comms/email/smtp';
import { createSmsProviderFromEnv } from '@bslt/comms/sms';
import { recordCapturedDevEmail } from '@bslt/contract';
import { createAuthEmailTemplates } from '@bslt/identity/server';
import { createStorage, DEFAULT_STORAGE_MAX_FILE_SIZE, type StorageConfig } from '@bslt/storage';

import { SERVER_BRAND } from '../../generated/brand';
import { type AppPorts, type DataContext, type InfraContext } from '../context';

import type { EmailOptions, EmailService, SendResult, StorageClient } from '@bslt/contract';
import type { AuthEmailTemplates } from '@bslt/identity/server';
import type { AppConfig } from '@bslt/server-system/config';

export interface CommsPhaseState {
  context: InfraContext;
}

function createFallbackEmailService(log: InfraContext['log']): EmailService {
  return {
    healthCheck(): Promise<boolean> {
      return Promise.resolve(true);
    },
    send(options: EmailOptions): Promise<SendResult> {
      const messageId = `core-fallback-${String(Date.now())}`;
      recordCapturedDevEmail({
        id: messageId,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });
      const body = options.text ?? options.html ?? '';
      const to = Array.isArray(options.to) ? options.to.join(', ') : options.to;
      log.info('Email rendered by core fallback provider');
      log.info(`To: ${to}`);
      log.info(`Subject: ${options.subject}`);
      if (body !== '') {
        log.info(body);
      }

      return Promise.resolve({
        success: true,
        messageId,
      });
    },
  };
}

function toStorageRuntimeConfig(config: AppConfig['storage']): StorageConfig {
  const base = {
    maxFileSize: DEFAULT_STORAGE_MAX_FILE_SIZE,
    allowedTypes: ['*'],
  };

  if (config.provider === 's3') {
    return {
      ...base,
      provider: 's3',
      bucket: config.bucket,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      forcePathStyle: config.forcePathStyle,
      presignExpiresInSeconds: config.presignExpiresInSeconds,
      ...(config.endpoint !== undefined ? { endpoint: config.endpoint } : {}),
    };
  }

  return {
    ...base,
    provider: 'local',
    rootPath: config.rootPath,
    signingSecret: config.signingSecret,
    ...(config.publicBaseUrl !== undefined ? { publicBaseUrl: config.publicBaseUrl } : {}),
  };
}

function createStorageService(config: AppConfig): StorageClient | undefined {
  const storageConfig = config.storage;
  return createStorage(toStorageRuntimeConfig(storageConfig));
}

function resolveBrandAppName(configured: string): string {
  return configured.trim() === '' || configured === 'Your App' ? SERVER_BRAND.name : configured;
}

export function createFallbackCommsState(
  config: AppConfig,
  data: { context: DataContext },
  ports: AppPorts = {},
): CommsPhaseState {
  const email = 'email' in ports ? ports.email : createFallbackEmailService(data.context.log);
  const context: InfraContext = Object.freeze({
    ...data.context,
    email,
    emailTemplates:
      ports.emailTemplates ??
      createAuthEmailTemplates({
        appName: resolveBrandAppName(config.app.name),
      }),
    storage: 'storage' in ports ? ports.storage : createStorageService(config),
    ...('notifications' in ports ? { notifications: ports.notifications } : {}),
    ...('sms' in ports ? { sms: ports.sms } : {}),
  });
  return { context };
}

/**
 * Compose the outbound services. A port the caller supplies is used as given
 * and its default is never constructed (no SMTP transport, no provider read
 * from the environment).
 */
export function bootstrapCommsPhase(
  config: AppConfig,
  data: DataContext,
  ports: AppPorts = {},
): Promise<CommsPhaseState> {
  const templates: AuthEmailTemplates = createEmailTemplates({
    appName: resolveBrandAppName(config.app.name),
    accentColor: SERVER_BRAND.emailAccent,
    supportEmail: SERVER_BRAND.supportEmail,
  });
  const composeEmail = (): EmailService =>
    config.email.provider === 'smtp'
      ? new SmtpEmailService(config.email)
      : new ConsoleEmailService();
  const email = 'email' in ports ? ports.email : composeEmail();

  // Push provider service (Web Push). Configured from env (VAPID keys);
  // unconfigured providers are inert, so this is safe when push is unused.
  const notifications =
    'notifications' in ports ? ports.notifications : createNotificationProviderServiceFromEnv();

  // SMS provider (phone verification / SMS 2FA). Reads SMS_*/TWILIO_* env and
  // falls back to the console provider when not configured, so the phone
  // endpoints work in dev and degrade gracefully instead of returning 503.
  const sms = 'sms' in ports ? ports.sms : createSmsProviderFromEnv();

  const context: InfraContext = Object.freeze({
    ...data,
    email,
    emailTemplates: ports.emailTemplates ?? templates,
    storage: 'storage' in ports ? ports.storage : createStorageService(config),
    notifications,
    sms,
  });

  context.log.info('Comms phase bootstrapped');
  return Promise.resolve({ context });
}

export function stopCommsPhase(_state: Partial<CommsPhaseState> | undefined): Promise<void> {
  // no-op for now (email provider has no async shutdown contract)
  return Promise.resolve();
}
