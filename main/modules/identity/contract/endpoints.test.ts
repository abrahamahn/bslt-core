// main/modules/identity/contract/endpoints.test.ts
import { describe, expect, it } from 'vitest';

import { identityEndpoints } from './endpoints';
import { identityErrors } from './errors';

describe('identityEndpoints', () => {
  it('declares all 86 endpoints with expected methods, paths, auth levels, and ToS gating', () => {
    expect(Object.keys(identityEndpoints)).toHaveLength(86);

    // /api/users/me and /api/auth/logout-all are intentionally ToS-exempt
    expect(identityEndpoints.me.method).toBe('GET');
    expect(identityEndpoints.me.path).toBe('/api/users/me');
    expect(identityEndpoints.me.auth).toBe('user');
    expect('requires' in identityEndpoints.me).toBe(false);

    expect(identityEndpoints.logoutAll.method).toBe('POST');
    expect(identityEndpoints.logoutAll.path).toBe('/api/auth/logout-all');
    expect(identityEndpoints.logoutAll.auth).toBe('user');
    expect('requires' in identityEndpoints.logoutAll).toBe(false);

    // register returns 200 (not 201) for anti-enumeration parity
    expect(identityEndpoints.register.method).toBe('POST');
    expect(identityEndpoints.register.path).toBe('/api/auth/register');
    expect('status' in identityEndpoints.register).toBe(false);

    const publicAuthEndpoints = new Set([
      'register',
      'login',
      'refresh',
      'logout',
      'authStrategies',
      'verifyEmail',
      'resendVerification',
      'forgotPassword',
      'resetPassword',
      'magicLinkRequest',
      'magicLinkVerify',
      'emailOtpRequest',
      'emailOtpVerify',
      'confirmEmailChange',
      'revertEmailChange',
      'smsSendCode',
      'smsVerifyCode',
      'totpVerifyLogin',
      'webauthnLoginOptions',
      'webauthnLoginVerify',
      'initiateGoogle',
      'initiateGithub',
      'initiateApple',
      'initiateKakao',
      'callbackGoogle',
      'callbackGithub',
      'callbackApple',
      'callbackKakao',
      'getEnabledProviders',
    ]);

    for (const [name, ep] of Object.entries(identityEndpoints)) {
      if (publicAuthEndpoints.has(name)) {
        expect(ep.auth, `${name}.auth`).toBe('public');
        expect('requires' in ep, `${name}.requires`).toBe(false);
        continue;
      }
      if (name === 'me' || name === 'logoutAll') continue;
      expect(
        (ep as { readonly requires?: readonly string[] }).requires,
        `${name}.requires`,
      ).toEqual(['tos.accepted']);
    }

    // Sibling query invalidations for MFA, devices, phone, and passkeys
    expect(identityEndpoints.trustDevice.invalidates).toEqual(['listDevices']);
    expect(identityEndpoints.revokeDevice.invalidates).toEqual(['listDevices']);
    expect(identityEndpoints.verifyPhone.invalidates).toEqual(['me', 'getProfileCompleteness']);
    expect(identityEndpoints.removePhone.invalidates).toEqual(['me', 'getProfileCompleteness']);
    expect(identityEndpoints.totpEnable.invalidates).toEqual(['totpStatus', 'backupCodesStatus']);
    expect(identityEndpoints.totpDisable.invalidates).toEqual(['totpStatus', 'backupCodesStatus']);
    expect(identityEndpoints.backupCodesRegenerate.invalidates).toEqual(['backupCodesStatus']);
    expect(identityEndpoints.webauthnRegisterVerify.invalidates).toEqual(['listPasskeys']);
    expect(identityEndpoints.renamePasskey.invalidates).toEqual(['listPasskeys']);
    expect(identityEndpoints.deletePasskey.invalidates).toEqual(['listPasskeys']);

    // Admin endpoints require admin auth; adminCreateUser returns 201
    expect(identityEndpoints.adminCreateUser.auth).toBe('admin');
    expect(identityEndpoints.adminCreateUser.status).toBe(201);
    expect(identityEndpoints.adminListUsers.auth).toBe('admin');
    expect(identityEndpoints.adminSearchUsers.auth).toBe('admin');
    expect(identityEndpoints.adminHardBanUser.auth).toBe('admin');
    expect(identityEndpoints.adminDeleteUser.auth).toBe('admin');

    // Sibling query invalidations
    expect(identityEndpoints.createApiKey.invalidates).toEqual(['listApiKeys']);
    expect(identityEndpoints.deleteApiKey.invalidates).toEqual(['listApiKeys']);
    expect(identityEndpoints.updateProfile.invalidates).toEqual(['me', 'getProfileCompleteness']);
    expect(identityEndpoints.updateUsername.invalidates).toEqual(['me', 'getProfileCompleteness']);
    expect(identityEndpoints.revokeSession.invalidates).toEqual(['listSessions']);
    expect(identityEndpoints.revokeAllSessions.invalidates).toEqual(['listSessions']);
  });

  it('declares sudo and domain error codes on destructive user and admin endpoints', () => {
    expect(identityEndpoints.deactivateAccount.errors).toContain(identityErrors.SUDO_REQUIRED);
    expect(identityEndpoints.deactivateAccount.errors).toContain(identityErrors.SUDO_EXPIRED);
    expect(identityEndpoints.deactivateAccount.errors).toContain(identityErrors.SUDO_MISMATCH);
    expect(identityEndpoints.deleteAccount.errors).toContain(identityErrors.SUDO_REQUIRED);
    expect(identityEndpoints.adminHardBanUser.errors).toContain(identityErrors.SUDO_REQUIRED);
    expect(identityEndpoints.adminDeleteUser.errors).toContain(identityErrors.SUDO_REQUIRED);
    expect(identityEndpoints.deleteApiKey.errors).toEqual([identityErrors.API_KEY_NOT_FOUND]);
  });

  it('rejects invalid request bodies, queries, and empty params across endpoint schemas', () => {
    expect(identityEndpoints.createApiKey.body?.safeParse({ name: '' }).success).toBe(false);
    expect(identityEndpoints.deleteApiKey.params?.safeParse({ id: '' }).success).toBe(false);
    expect(identityEndpoints.deleteApiKey.body?.safeParse({ extra: 1 }).success).toBe(false);
    expect(identityEndpoints.updateUsername.body?.safeParse({ username: 'admin' }).success).toBe(
      false,
    );
    expect(identityEndpoints.adminSearchUsers.query?.safeParse({ q: '' }).success).toBe(false);
    expect(identityEndpoints.adminUpdateUser.body?.safeParse({}).success).toBe(false);
    expect(identityEndpoints.adminLockUser.body?.safeParse({ reason: '' }).success).toBe(false);
    expect(identityEndpoints.revokeSession.params?.safeParse({ id: '' }).success).toBe(false);
    expect(identityEndpoints.sudo.body?.safeParse({}).success).toBe(false);
    expect(identityEndpoints.setPhone.body?.safeParse({ phone: '123' }).success).toBe(false);
    expect(identityEndpoints.verifyPhone.body?.safeParse({ code: '12' }).success).toBe(false);
    expect(identityEndpoints.totpEnable.body?.safeParse({ code: '123' }).success).toBe(false);
    expect(
      identityEndpoints.totpVerifyLogin.body?.safeParse({ challengeToken: '', code: '123456' })
        .success,
    ).toBe(false);
    expect(identityEndpoints.renamePasskey.body?.safeParse({ name: '   ' }).success).toBe(false);
    expect(
      identityEndpoints.webauthnLoginVerify.body?.safeParse({ credential: {}, sessionKey: '' })
        .success,
    ).toBe(false);
    expect(identityEndpoints.register.body?.safeParse({}).success).toBe(false);
    expect(identityEndpoints.login.body?.safeParse({}).success).toBe(false);
    expect(identityEndpoints.forgotPassword.body?.safeParse({}).success).toBe(false);
    expect(
      identityEndpoints.emailOtpVerify.body?.safeParse({ email: 'a@b.io', code: '12' }).success,
    ).toBe(false);
    expect(identityEndpoints.changeEmail.body?.safeParse({}).success).toBe(false);
  });
});
