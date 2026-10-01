// main/server/comms/src/sms/index.ts

export { ConsoleSmsProvider } from './console';
export { createSmsProvider, createSmsProviderFromEnv } from './factory';
export { TwilioSmsProvider, type TwilioConfig } from './twilio';
export type { SmsConfig, SmsOptions, SmsProvider, SmsResult } from '@bslt/shared/comms/sms';
