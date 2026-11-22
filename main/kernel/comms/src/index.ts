// main/kernel/comms/src/index.ts

export {
  SmtpClient,
  createEmailTemplates,
  type EmailOptions,
  type EmailResult,
  type EmailService,
  type SmtpConfig,
  type SmtpMessage,
} from './email';
export {
  ConsoleSmsProvider,
  TwilioSmsProvider,
  createSmsProvider,
  createSmsProviderFromEnv,
  type SmsConfig,
  type SmsOptions,
  type SmsProvider,
  type SmsResult,
  type TwilioConfig,
} from './sms';
export {
  WebPushProvider,
  createWebPushProvider,
  createNotificationProviderService,
  createNotificationProviderServiceFromEnv,
  type VapidConfig,
  type NotificationFactoryOptions,
  type NotificationProviderService,
  type PushNotificationProvider,
  type SendOptions,
  type SubscriptionWithId,
} from './notifications/providers';
