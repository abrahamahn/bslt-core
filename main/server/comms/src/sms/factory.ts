// main/server/comms/src/sms/factory.ts
/**
 * SMS Provider Factory
 *
 * Creates the appropriate SMS provider based on configuration.
 *
 * @module SMS
 */

import { ConsoleSmsProvider } from './console';
import { TwilioSmsProvider } from './twilio';

import type { TwilioConfig } from './twilio';
import type { SmsConfig, SmsProvider } from '@bslt/shared/comms/sms';

/**
 * Create an SMS provider based on the given configuration.
 *
 * @param config - SMS service configuration
 * @param twilioConfig - Optional Twilio-specific configuration (required when provider is 'twilio')
 * @returns An SmsProvider instance
 * @throws Error if an unsupported provider is specified
 */
export function createSmsProvider(config: SmsConfig, twilioConfig?: TwilioConfig): SmsProvider {
  if (!config.enabled) {
    return new ConsoleSmsProvider();
  }

  switch (config.provider) {
    case 'console':
      return new ConsoleSmsProvider();
    case 'twilio': {
      if (twilioConfig === undefined) {
        throw new Error(
          'Twilio configuration (accountSid, authToken, fromNumber) is required when using the Twilio provider.',
        );
      }
      return new TwilioSmsProvider(twilioConfig);
    }
    default: {
      const _exhaustive: never = config.provider;
      throw new Error(`Unknown SMS provider: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Create an SMS provider from environment variables.
 *
 * Reads `SMS_*` / `TWILIO_*` env vars and returns the configured provider.
 * Anything short of a fully-configured real provider (disabled, console,
 * or incomplete Twilio credentials) degrades to the
 * dev-safe console provider, so the SMS endpoints are always usable and this
 * never throws during bootstrap.
 *
 * Env:
 * - `SMS_ENABLED`: `'true'` activates a real provider (default: console)
 * - `SMS_PROVIDER`: `'console' | 'twilio'` (default: `'console'`)
 * - `SMS_FROM`: default sender number (E.164)
 * - `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER`: Twilio creds
 *
 * @param env - Environment source (defaults to `process.env`)
 * @returns An SmsProvider instance (console provider unless real SMS is fully configured)
 * @complexity O(1)
 */
export function createSmsProviderFromEnv(env: NodeJS.ProcessEnv = process.env): SmsProvider {
  const enabled = env['SMS_ENABLED'] === 'true';
  const rawProvider = env['SMS_PROVIDER'];
  const provider: SmsConfig['provider'] = rawProvider === 'twilio' ? rawProvider : 'console';
  const from = env['SMS_FROM'];
  const config: SmsConfig = { enabled, provider, ...(from !== undefined ? { from } : {}) };

  if (enabled && provider === 'twilio') {
    const accountSid = env['TWILIO_ACCOUNT_SID'] ?? '';
    const authToken = env['TWILIO_AUTH_TOKEN'] ?? '';
    const fromNumber = env['TWILIO_FROM_NUMBER'] ?? from ?? '';
    if (accountSid !== '' && authToken !== '' && fromNumber !== '') {
      return createSmsProvider(config, { accountSid, authToken, fromNumber });
    }
  }

  return new ConsoleSmsProvider();
}
