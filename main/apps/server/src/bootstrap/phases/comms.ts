// Core edition provider composition.
import { createAuthEmailTemplates } from '@bslt/core/auth';
import { ConsoleEmailService } from '@bslt/comms/email/console';
import { SmtpEmailService } from '@bslt/comms/email/smtp';
import { createNotificationProviderServiceFromEnv } from '@bslt/comms';
import { createSmsProviderFromEnv } from '@bslt/comms/sms';
import { createStorage, DEFAULT_STORAGE_MAX_FILE_SIZE, type StorageConfig } from '@bslt/storage';
import type { DataContext, InfraContext } from '../context';
import type { StorageClient } from '@bslt/shared/contracts';
import type { AppConfig } from '@bslt/shared/system/config';
export interface CommsPhaseState {
  context: InfraContext;
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
    ...(config.publicBaseUrl !== undefined ? { publicBaseUrl: config.publicBaseUrl } : {}),
  };
}

function createStorageService(config: AppConfig): StorageClient | undefined {
  const storageConfig = config.storage;
  return createStorage(toStorageRuntimeConfig(storageConfig));
}

export function createFallbackCommsState(
  config: AppConfig,
  data: { context: DataContext },
): CommsPhaseState {
  return {
    context: Object.freeze({
      ...data.context,
      email:
        config.email.provider === 'smtp'
          ? new SmtpEmailService(config.email)
          : new ConsoleEmailService(),
      emailTemplates: createAuthEmailTemplates({ appName: config.app.name }),
      storage: createStorageService(config),
      sms: createSmsProviderFromEnv(),
      notifications: createNotificationProviderServiceFromEnv(),
    }),
  };
}
export async function bootstrapCommsPhase(
  config: AppConfig,
  data: DataContext,
): Promise<CommsPhaseState> {
  return createFallbackCommsState(config, { context: data });
}
export async function stopCommsPhase(_state: Partial<CommsPhaseState> | undefined): Promise<void> {}
