// main/kernel/comms/src/sms/factory.test.ts
/**
 * Tests for the SMS provider factory and its env-driven wrapper.
 *
 * Emphasis on the degradation paths: anything short of a fully-configured real
 * provider must fall back to the console provider and never throw at bootstrap.
 */

import { describe, expect, it } from 'vitest';

import { ConsoleSmsProvider } from './console';
import { createSmsProvider, createSmsProviderFromEnv } from './factory';
import { TwilioSmsProvider } from './twilio';

const TWILIO_ENV = {
  SMS_ENABLED: 'true',
  SMS_PROVIDER: 'twilio',
  TWILIO_ACCOUNT_SID: 'AC0000000000000000000000000000000',
  TWILIO_AUTH_TOKEN: 'auth-token-value',
  TWILIO_FROM_NUMBER: '+15555550123',
} satisfies NodeJS.ProcessEnv;

describe('createSmsProvider', () => {
  it('returns a console provider when SMS is disabled', () => {
    expect(createSmsProvider({ enabled: false, provider: 'twilio' })).toBeInstanceOf(
      ConsoleSmsProvider,
    );
  });

  it('returns a console provider for the console provider', () => {
    expect(createSmsProvider({ enabled: true, provider: 'console' })).toBeInstanceOf(
      ConsoleSmsProvider,
    );
  });

  it('throws when twilio is selected without twilio config', () => {
    expect(() => createSmsProvider({ enabled: true, provider: 'twilio' })).toThrow(/Twilio/);
  });
});

describe('createSmsProviderFromEnv', () => {
  it('defaults to the console provider when no SMS env is set', () => {
    expect(createSmsProviderFromEnv({})).toBeInstanceOf(ConsoleSmsProvider);
  });

  it('uses the console provider when SMS_ENABLED is not exactly "true"', () => {
    expect(createSmsProviderFromEnv({ SMS_ENABLED: '1', SMS_PROVIDER: 'twilio' })).toBeInstanceOf(
      ConsoleSmsProvider,
    );
  });

  it('uses the console provider when provider is console even if enabled', () => {
    expect(
      createSmsProviderFromEnv({ SMS_ENABLED: 'true', SMS_PROVIDER: 'console' }),
    ).toBeInstanceOf(ConsoleSmsProvider);
  });

  it('degrades to console for an unknown provider value', () => {
    expect(
      createSmsProviderFromEnv({ SMS_ENABLED: 'true', SMS_PROVIDER: 'carrier-pigeon' }),
    ).toBeInstanceOf(ConsoleSmsProvider);
  });

  it('degrades to console when twilio credentials are incomplete', () => {
    const { TWILIO_AUTH_TOKEN: _omitted, ...partial } = TWILIO_ENV;
    expect(createSmsProviderFromEnv(partial)).toBeInstanceOf(ConsoleSmsProvider);
  });

  it('returns the twilio provider when fully configured', () => {
    expect(createSmsProviderFromEnv(TWILIO_ENV)).toBeInstanceOf(TwilioSmsProvider);
  });

  it('falls back to SMS_FROM when TWILIO_FROM_NUMBER is absent', () => {
    const { TWILIO_FROM_NUMBER: _omitted, ...rest } = TWILIO_ENV;
    expect(createSmsProviderFromEnv({ ...rest, SMS_FROM: '+15555550199' })).toBeInstanceOf(
      TwilioSmsProvider,
    );
  });
});
