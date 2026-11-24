// main/modules/identity/module.test.ts
import { describe, expect, it } from 'vitest';

import { defineModule, validateModule, validateModules } from '@bslt/contract';

import { identityModule } from './module';

describe('identityModule', () => {
  it('validates cleanly as a foundational root module with 82 endpoints, 10 events, 5 cron jobs, and optional env', () => {
    expect(() => validateModule(identityModule)).not.toThrow();
    expect(identityModule.id).toBe('identity');
    expect(identityModule.dependsOn).toEqual([]);
    expect('web' in identityModule).toBe(false);
    expect(Object.keys(identityModule.endpoints)).toHaveLength(82);
    expect(Object.keys(identityModule.endpoints)).toEqual(
      expect.arrayContaining([
        'register',
        'login',
        'refresh',
        'logout',
        'authStrategies',
        'magicLinkVerify',
        'emailOtpVerify',
        'completeOnboarding',
        'changeEmail',
        'listApiKeys',
        'me',
        'sudo',
        'logoutAll',
        'invalidateSessions',
        'listDevices',
        'setPhone',
        'smsVerifyCode',
        'totpSetup',
        'totpVerifyLogin',
        'webauthnLoginVerify',
        'listPasskeys',
        'initiateGoogle',
        'callbackGoogle',
        'linkGoogle',
        'unlinkGoogle',
        'getConnections',
        'getEnabledProviders',
      ]),
    );
    expect(Object.keys(identityModule.events)).toEqual([
      'userRegistered',
      'sessionRevoked',
      'accountAlerted',
      'apiKeyCreated',
      'apiKeyRevoked',
      'userForceLoggedOut',
      'userHardBanned',
      'userSoftDeleted',
      'oauthLinked',
      'oauthUnlinked',
    ]);
    expect(Object.keys(identityModule.jobs)).toEqual([
      'sessionCleanup',
      'userRetention',
      'loginCleanup',
      'authTokensCleanup',
      'oauthRefresh',
    ]);
    expect(identityModule.env?.parse({})).toEqual({});
    expect(
      identityModule.env?.parse({
        JWT_SECRET: 'super-secret-at-least-32-characters-long!',
        APP_BASE_URL: 'https://app.bslt.dev',
        ARGON2_MEMORY_COST: '4096',
        ARGON2_TIME_COST: '2',
        ARGON2_PARALLELISM: '1',
        LOCKOUT_BASE_DELAY_MS: '0',
        LOCKOUT_DURATION_MS: '0',
        MAX_CONCURRENT_SESSIONS: '0',
      }),
    ).toEqual({
      JWT_SECRET: 'super-secret-at-least-32-characters-long!',
      APP_BASE_URL: 'https://app.bslt.dev',
      ARGON2_MEMORY_COST: 4096,
      ARGON2_TIME_COST: 2,
      ARGON2_PARALLELISM: 1,
      LOCKOUT_BASE_DELAY_MS: 0,
      LOCKOUT_DURATION_MS: 0,
      MAX_CONCURRENT_SESSIONS: 0,
    });
  });

  it('rejects invalid env values on identityModule.env', () => {
    expect(identityModule.env?.safeParse({ ARGON2_MEMORY_COST: '10' }).success).toBe(false);
    expect(identityModule.env?.safeParse({ ARGON2_TIME_COST: '0' }).success).toBe(false);
    expect(identityModule.env?.safeParse({ ARGON2_PARALLELISM: '-1' }).success).toBe(false);
    expect(identityModule.env?.safeParse({ UNKNOWN_KEY: '1' }).success).toBe(false);
  });

  it('rejects duplicate registration of identityModule in an install list', () => {
    expect(() => validateModules([identityModule, identityModule])).toThrow(/duplicate/iu);
  });

  it('rejects a table without the identity prefix on an identity manifest copy', () => {
    expect(() =>
      defineModule({
        ...identityModule,
        tables: ['users' as 'identity'],
      }),
    ).toThrow(/must equal "identity" or start with "identity_"/iu);
  });

  it('rejects an invalid module id containing hyphens', () => {
    expect(() =>
      defineModule({
        ...identityModule,
        id: 'identity-core',
      }),
    ).toThrow(/lowercase/iu);
  });
});
