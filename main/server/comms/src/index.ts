// main/server/comms/src/index.ts

export {
  SmtpClient,
  createEmailTemplates,
  emailTemplates,
  type AuthEmailTemplates,
  type EmailOptions,
  type EmailResult,
  type EmailService,
  type EmailTemplateOptions,
  type SmtpConfig,
  type SmtpMessage,
  type SmtpResult,
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
