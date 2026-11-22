// main/kernel/comms/src/sms/types.ts

export interface SmsOptions {
  to: string;
  body: string;
}

export interface SmsResult {
  success: boolean;
  messageId?: string | undefined;
  error?: string | undefined;
}

export interface SmsProvider {
  send(options: SmsOptions): Promise<SmsResult>;
}

export interface SmsConfig {
  enabled: boolean;
  provider: 'console' | 'twilio';
  from?: string | undefined;
}
