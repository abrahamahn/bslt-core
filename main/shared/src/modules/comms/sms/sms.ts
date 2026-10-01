// main/shared/src/modules/comms/sms/sms.ts

/** Options for sending an SMS message */
export interface SmsOptions {
  /** Recipient phone number in E.164 format (e.g., +15551234567) */
  to: string;
  /** SMS message body */
  body: string;
}

/** Result of an SMS sending operation */
export interface SmsResult {
  /** Whether the SMS was sent successfully */
  success: boolean;
  /** Message ID from the SMS provider (if available) */
  messageId?: string | undefined;
  /** Error message if sending failed */
  error?: string | undefined;
}

/** SMS provider interface for concrete adapters (Twilio, etc.) */
export interface SmsProvider {
  /** Send an SMS message */
  send(options: SmsOptions): Promise<SmsResult>;
}

/** SMS service configuration */
export interface SmsConfig {
  /** Whether SMS features are enabled */
  enabled: boolean;
  /** Provider name (for factory selection) */
  provider: 'console' | 'twilio';
  /** Sender phone number or short code in E.164 format */
  from?: string | undefined;
}
