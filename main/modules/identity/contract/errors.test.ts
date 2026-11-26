// main/modules/identity/contract/errors.test.ts
import { describe, expect, it } from 'vitest';

import { lookupErrorCode } from '@bslt/contract';

import { identityErrors } from './errors';

describe('identityErrors', () => {
  it('registers all identity error codes with expected HTTP statuses', () => {
    const expected: Readonly<Record<keyof typeof identityErrors, number>> = {
      API_KEY_NOT_FOUND: 404,
      USER_NOT_FOUND: 404,
      SESSION_NOT_FOUND: 404,
      USERNAME_RESERVED: 400,
      USERNAME_UNCHANGED: 400,
      USERNAME_TAKEN: 409,
      PROFILE_USERNAME_TAKEN: 400,
      USERNAME_COOLDOWN_ACTIVE: 429,
      PASSWORD_NOT_SET: 400,
      INVALID_PASSWORD: 400,
      WEAK_PASSWORD: 400,
      SUDO_REQUIRED: 403,
      SUDO_EXPIRED: 403,
      SUDO_MISMATCH: 403,
      LIFECYCLE_TRANSITION_INVALID: 400,
      SELF_LOCK_FORBIDDEN: 400,
      SELF_BAN_FORBIDDEN: 400,
      SELF_DELETE_FORBIDDEN: 400,
      USER_ALREADY_EXISTS: 409,
      EMAIL_SERVICE_UNAVAILABLE: 500,
      INVALID_CREDENTIALS: 401,
      SUDO_CREDENTIAL_REQUIRED: 400,
      TOTP_NOT_ENABLED: 400,
      TOTP_NOT_CONFIGURED: 400,
      TOTP_INVALID_CODE: 401,
      TOTP_ENABLE_FAILED: 400,
      TOTP_DISABLE_FAILED: 400,
      BACKUP_CODES_REGENERATE_FAILED: 400,
      CHALLENGE_TOKEN_INVALID: 401,
      TOO_MANY_ATTEMPTS: 429,
      DEVICE_NOT_FOUND: 404,
      INVALID_PHONE_NUMBER: 400,
      SMS_RATE_LIMIT: 429,
      SMS_SERVICE_UNAVAILABLE: 503,
      SMS_SEND_FAILED: 502,
      SMS_VERIFICATION_FAILED: 400,
      PHONE_VERIFICATION_PENDING: 400,
      PHONE_NOT_VERIFIED: 400,
      SMS_CODE_INVALID: 401,
      WEBAUTHN_DISABLED: 404,
      WEBAUTHN_FAILED: 400,
      PASSKEY_NOT_FOUND: 404,
      SIGNUP_CONSENT_REQUIRED: 403,
      ELIGIBILITY_ATTESTATION_REQUIRED: 403,
      LOCAL_AUTH_DISABLED: 404,
      MAGIC_LINK_DISABLED: 404,
      CAPTCHA_VERIFICATION_FAILED: 400,
      ACCOUNT_LOCKED: 429,
      EMAIL_NOT_VERIFIED: 401,
      EMAIL_SEND_FAILED: 503,
      INVALID_TOKEN: 401,
      NO_REFRESH_TOKEN: 401,
      PASSWORD_ALREADY_SET: 409,
      ONBOARDING_ALREADY_COMPLETE: 409,
      RESERVED_EMAIL_DOMAIN: 422,
      OAUTH_NOT_CONFIGURED: 400,
      OAUTH_FAILED: 400,
      OAUTH_STATE_MISMATCH: 400,
      OAUTH_EMAIL_EXISTS: 409,
      OAUTH_ALREADY_LINKED: 409,
      OAUTH_LINKED_TO_OTHER: 409,
      OAUTH_CONNECTION_NOT_FOUND: 404,
      CANNOT_UNLINK_ONLY_AUTH: 409,
      SSO_REQUIRED: 403,
      WAITLIST_REQUIRED: 403,
    };

    for (const [name, status] of Object.entries(expected)) {
      const code = identityErrors[name as keyof typeof identityErrors];
      expect(code).toBe(`identity.${name}`);
      expect(lookupErrorCode(code)).toMatchObject({
        code: `identity.${name}`,
        status,
      });
    }
  });

  it('freezes the error map and returns undefined for unregistered identity codes', () => {
    expect(Object.isFrozen(identityErrors)).toBe(true);
    expect(() => {
      (identityErrors as Record<string, unknown>)['TAMPERED'] = 'identity.TAMPERED';
    }).toThrow(TypeError);
    expect(lookupErrorCode('identity.NO_SUCH_ERROR')).toBeUndefined();
    expect(lookupErrorCode('SUDO_REQUIRED')).toBeUndefined();
  });
});
