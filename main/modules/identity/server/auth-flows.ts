// main/modules/identity/server/auth-flows.ts
import { createHash, randomBytes } from 'node:crypto';

import { getMetricsCollector } from '@bslt/server-system/observability';

import {
  canReactivate,
  createSignupAttestation,
  getAccountStatus,
  isAttestationConfirmed,
  validatePassword,
  type CompleteOnboardingRequest,
  type EmailOtpVerifyResponse,
  type MagicLinkVerifyResponse,
  type RegisterResponse,
  type SmsLoginChallengeResponse,
  type TotpLoginChallengeResponse,
  type User,
} from '../contract';

import {
  DEFAULT_ARGON2_CONFIG,
  canonicalizeEmail,
  createAccessToken,
  createChallengeToken,
  createRefreshToken,
  generateBase64UrlToken,
  generateNumericCode,
  generateSecureToken,
  getRefreshTokenExpiry,
  hashPassword,
  hashToken,
  hasPassword,
  invalidateLiveness,
  needsRehash,
  normalizeEmail,
  verifyPasswordSafe,
  type Argon2Config,
  type AuthEmailTemplates,
} from './crypto';
import { isReservedAnonymizedEmail } from './retention';
import {
  issueSession,
  revokeAllUserTokensInRepo,
  revokeTokenFamilyInRepo,
  toUserDto,
  type IssuedSession,
  type RefreshCookieConfig,
} from './service';

import type { IdentityRepository, RefreshTokenFamilyView, User as DbUser } from './repository';
import type { RequestContext, Tx } from '@bslt/server-system/module';

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const CAPTCHA_TIMEOUT_MS = 10 * MS_PER_SECOND;

const PROGRESSIVE_DELAY_WINDOW_MS = 5 * MS_PER_MINUTE;
const MAX_PROGRESSIVE_DELAY_MS = 30 * MS_PER_SECOND;

const VERIFICATION_TOKEN_HOURS = 24;
const EMAIL_CHANGE_HOURS = 24;
const EMAIL_CHANGE_REVERT_HOURS = 48;

const MAGIC_LINK_TOKEN_BYTES = 32;
const DEFAULT_MAGIC_LINK_EXPIRY_MINUTES = 15;
const DEFAULT_MAGIC_LINK_MAX_PER_EMAIL = 3;
const DEFAULT_MAGIC_LINK_MAX_PER_IP = 10;

const EMAIL_OTP_DIGITS = 6;
const DEFAULT_EMAIL_OTP_EXPIRY_MINUTES = 10;
const DEFAULT_EMAIL_OTP_MAX_PER_EMAIL = 5;
const DEFAULT_EMAIL_OTP_MAX_PER_IP = 15;
const MAX_OTP_VERIFY_ATTEMPTS = 5;

const MAX_AUTO_USERNAME_LENGTH = 15;
const USERNAME_SANITIZE_REGEX = /[^a-z0-9_]/gu;
const MAX_USERNAME_COLLISION_RETRIES = 5;
const USERNAME_SUFFIX_BYTES = 2;

export const SIGNUP_CONSENT_REQUIRED_MESSAGE =
  'To create an account you must accept the Terms of Service and Privacy Policy.';

export const ELIGIBILITY_ATTESTATION_REQUIRED_MESSAGE =
  'To create an account you must confirm that you are old enough to consent in your country, meet your jurisdiction’s requirements, and accept the Terms of Service.';

const REGISTER_PENDING_MESSAGE =
  'Registration successful! Please check your email inbox and click the confirmation link to complete your registration.';

export interface LockoutConfig {
  readonly maxAttempts: number;
  readonly lockoutDurationMs: number;
  readonly progressiveDelay: boolean;
  readonly baseDelayMs: number;
}

export interface CaptchaConfig {
  readonly enabled: boolean;
  readonly secretKey: string;
}

export interface CaptchaVerifyResult {
  readonly success: boolean;
  readonly errorCodes: readonly string[];
}

type IdentityEmailSendFn = (options: {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string | undefined;
}) => Promise<{ readonly success: boolean; readonly error?: string | undefined }>;

export interface SignupComplianceHooks {
  readonly peekAgreements: (tx: Tx) => Promise<ReadonlyArray<{ readonly id: string }>>;
  readonly recordConsents: (
    tx: Tx,
    input: {
      readonly userId: string;
      readonly documentIds: readonly string[];
      readonly ipAddress?: string | undefined;
      readonly userAgent?: string | undefined;
    },
  ) => Promise<void>;
}

export class ConsentedUserRefusalError extends Error {
  public readonly code: 'SIGNUP_CONSENT_REQUIRED' | 'ELIGIBILITY_ATTESTATION_REQUIRED';

  constructor(
    code: 'SIGNUP_CONSENT_REQUIRED' | 'ELIGIBILITY_ATTESTATION_REQUIRED',
    message: string,
  ) {
    super(message);
    this.name = 'ConsentedUserRefusalError';
    this.code = code;
  }
}

function isConsentConfirmed(value: unknown): value is true {
  return value === true;
}

// ============================================================================
// 1. CAPTCHA, Device Fingerprinting & Auto-Username Generation
// ============================================================================

export async function verifyTurnstileToken(
  secretKey: string,
  token: string,
  remoteIp?: string | null,
): Promise<CaptchaVerifyResult> {
  try {
    const body = new URLSearchParams({
      secret: secretKey,
      response: token,
    });
    if (remoteIp !== undefined && remoteIp !== null && remoteIp !== '') {
      body.set('remoteip', remoteIp);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, CAPTCHA_TIMEOUT_MS);

    try {
      const response = await fetch(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          success: false,
          errorCodes: [`http-error-${String(response.status)}`],
        };
      }
      const data = (await response.json()) as {
        readonly success?: boolean;
        readonly 'error-codes'?: readonly string[];
      };
      return {
        success: data.success === true,
        errorCodes: Array.isArray(data['error-codes']) ? data['error-codes'] : [],
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return {
      success: false,
      errorCodes: ['network-error'],
    };
  }
}

export async function verifyCaptchaToken(
  config: CaptchaConfig,
  token: string,
  remoteIp?: string | null,
): Promise<CaptchaVerifyResult> {
  if (!config.enabled) {
    return { success: true, errorCodes: [] };
  }
  if (token === '') {
    return { success: false, errorCodes: ['missing-input-response'] };
  }
  return verifyTurnstileToken(config.secretKey, token, remoteIp);
}

export function generateDeviceFingerprint(identity: string, userAgent: string): string {
  return createHash('sha256').update(`${identity}:${userAgent}`).digest('hex');
}

export function generateStableDeviceFingerprint(deviceId: string): string {
  return createHash('sha256').update(`device:${deviceId}`).digest('hex');
}

export function readValidatedDeviceIdHeader(
  headers: RequestContext['headers'],
): string | undefined {
  const raw = headers?.['x-device-id'];
  const value = typeof raw === 'string' ? raw : raw !== undefined ? raw[0] : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^[a-zA-Z0-9._:-]{16,128}$/u.test(trimmed) ? trimmed : undefined;
}

export async function generateUniqueUsernameInRepo(
  repo: Pick<IdentityRepository, 'findUserByUsername'>,
  email: string,
): Promise<string> {
  const rawPrefix = email.split('@')[0] ?? 'user';
  const sanitized = rawPrefix.toLowerCase().replace(USERNAME_SANITIZE_REGEX, '');
  const prefix = sanitized.length > 0 ? sanitized.slice(0, MAX_AUTO_USERNAME_LENGTH) : 'user';

  const existing = await repo.findUserByUsername(prefix);
  if (existing === null) {
    return prefix;
  }

  const suffixLength = 1 + USERNAME_SUFFIX_BYTES * 2;
  const truncatedPrefix = prefix.slice(0, MAX_AUTO_USERNAME_LENGTH - suffixLength);

  for (let attempt = 0; attempt < MAX_USERNAME_COLLISION_RETRIES; attempt++) {
    const suffix = randomBytes(USERNAME_SUFFIX_BYTES).toString('hex');
    const candidate = `${truncatedPrefix}_${suffix}`;
    const check = await repo.findUserByUsername(candidate);
    if (check === null) {
      return candidate;
    }
  }

  return `user_${randomBytes(4).toString('hex')}`.slice(0, MAX_AUTO_USERNAME_LENGTH);
}

export function splitFullName(name: string | null): { firstName: string; lastName: string } {
  if (name === null || name.trim() === '') {
    return { firstName: 'User', lastName: '' };
  }
  const trimmed = name.trim();
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) {
    return { firstName: trimmed, lastName: '' };
  }
  return {
    firstName: trimmed.slice(0, spaceIndex),
    lastName: trimmed.slice(spaceIndex + 1).trim(),
  };
}

// ============================================================================
// 2. Signup Consent & Eligibility Attestation Chokepoint
// ============================================================================

export async function createConsentedUserInRepo(
  repo: Pick<IdentityRepository, 'createUser'>,
  values: {
    readonly email: string;
    readonly canonicalEmail: string;
    readonly username: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly avatarUrl?: string | null | undefined;
    readonly passwordHash: string;
    readonly role: 'user';
    readonly emailVerified: boolean;
    readonly emailVerifiedAt?: Date | null | undefined;
  },
  consent: {
    readonly agreed: unknown;
    readonly attested: unknown;
    readonly ipAddress?: string | undefined;
    readonly userAgent?: string | undefined;
  },
  hooks: SignupComplianceHooks,
  tx?: Tx,
  now: Date = new Date(),
): Promise<DbUser> {
  const txHandle = tx ?? ({} as Tx);
  const agreements = await hooks.peekAgreements(txHandle);
  if (agreements.length > 0 && !isConsentConfirmed(consent.agreed)) {
    throw new ConsentedUserRefusalError('SIGNUP_CONSENT_REQUIRED', SIGNUP_CONSENT_REQUIRED_MESSAGE);
  }
  if (!isAttestationConfirmed(consent.attested)) {
    throw new ConsentedUserRefusalError(
      'ELIGIBILITY_ATTESTATION_REQUIRED',
      ELIGIBILITY_ATTESTATION_REQUIRED_MESSAGE,
    );
  }

  const attestation = createSignupAttestation(now);
  const user = await repo.createUser({
    email: values.email,
    canonicalEmail: values.canonicalEmail,
    username: values.username,
    firstName: values.firstName,
    lastName: values.lastName,
    ...(values.avatarUrl !== undefined ? { avatarUrl: values.avatarUrl } : {}),
    passwordHash: values.passwordHash,
    role: values.role,
    emailVerified: values.emailVerified,
    ...(values.emailVerifiedAt !== undefined ? { emailVerifiedAt: values.emailVerifiedAt } : {}),
    eligibilityAttestedAt: attestation.attestedAt,
    eligibilityAttestationVersion: attestation.version,
  });

  if (agreements.length > 0) {
    await hooks.recordConsents(txHandle, {
      userId: user.id,
      documentIds: agreements.map((doc) => doc.id),
      ...(consent.ipAddress !== undefined ? { ipAddress: consent.ipAddress } : {}),
      ...(consent.userAgent !== undefined ? { userAgent: consent.userAgent } : {}),
    });
  }

  return user;
}

// ============================================================================
// 3. Lockout & Progressive Delay
// ============================================================================

export async function isAccountLockedInRepo(
  repo: Pick<IdentityRepository, 'countRecentFailedLoginAttempts'>,
  email: string,
  lockoutConfig: LockoutConfig,
  now: Date = new Date(),
): Promise<boolean> {
  const windowStart = new Date(now.getTime() - lockoutConfig.lockoutDurationMs);
  const failed = await repo.countRecentFailedLoginAttempts(email, windowStart);
  return failed >= lockoutConfig.maxAttempts;
}

export async function getProgressiveDelayInRepo(
  repo: Pick<
    IdentityRepository,
    'countRecentFailedLoginAttempts' | 'findMostRecentFailedLoginAttemptAt'
  >,
  email: string,
  lockoutConfig: LockoutConfig,
  now: Date = new Date(),
): Promise<number> {
  if (!lockoutConfig.progressiveDelay) {
    return 0;
  }
  const windowStart = new Date(now.getTime() - PROGRESSIVE_DELAY_WINDOW_MS);
  const failed = await repo.countRecentFailedLoginAttempts(email, windowStart);
  if (failed === 0) {
    return 0;
  }
  const delay = Math.min(
    lockoutConfig.baseDelayMs * Math.pow(2, failed - 1),
    MAX_PROGRESSIVE_DELAY_MS,
  );
  const mostRecent = await repo.findMostRecentFailedLoginAttemptAt(email, windowStart);
  if (mostRecent === null) {
    return 0;
  }
  return Math.max(0, delay - (now.getTime() - mostRecent.getTime()));
}

async function recordFailedLoginAttempt(
  repo: Pick<
    IdentityRepository,
    'insertLoginAttempt' | 'countRecentFailedLoginAttempts' | 'findMostRecentFailedLoginAttemptAt'
  >,
  email: string,
  failureReason: string,
  lockoutConfig: LockoutConfig,
  ipAddress?: string | null,
  userAgent?: string | null,
  now: Date = new Date(),
): Promise<{ readonly becameLocked: boolean }> {
  await repo.insertLoginAttempt({ email, success: false, ipAddress, userAgent, failureReason });
  const locked = await isAccountLockedInRepo(repo, email, lockoutConfig, now);
  if (locked) {
    getMetricsCollector().recordLockout();
  }
  return { becameLocked: locked };
}

// ============================================================================
// 4. Email Verification & Resend
// ============================================================================

export async function createEmailVerificationTokenInRepo(
  repo: Pick<IdentityRepository, 'insertAuthToken'>,
  userId: string,
  now: Date = new Date(),
): Promise<string> {
  const { plain, hash } = generateSecureToken();
  const expiresAt = new Date(now.getTime() + VERIFICATION_TOKEN_HOURS * MS_PER_HOUR);
  await repo.insertAuthToken({
    type: 'email_verification',
    userId,
    tokenHash: hash,
    expiresAt,
  });
  return plain;
}

export async function resendVerificationEmailInRepo(options: {
  readonly repo: Pick<
    IdentityRepository,
    'findUserByEmail' | 'invalidateUnusedAuthTokens' | 'insertAuthToken'
  >;
  readonly runInTx: <T>(
    fn: (
      txRepo: Pick<IdentityRepository, 'invalidateUnusedAuthTokens' | 'insertAuthToken'>,
    ) => Promise<T>,
  ) => Promise<T>;
  readonly email: string;
  readonly appBaseUrl: string;
  readonly emailTemplates: AuthEmailTemplates;
  readonly sendEmail?: IdentityEmailSendFn | undefined;
  readonly now?: Date | undefined;
}): Promise<
  | { readonly ok: true; readonly sent: boolean }
  | { readonly ok: false; readonly code: 'EMAIL_SEND_FAILED'; readonly error: string }
> {
  const now = options.now ?? new Date();
  const user = await options.repo.findUserByEmail(options.email);
  if (user === null || user.emailVerified) {
    return { ok: true, sent: false };
  }

  const plainToken = await options.runInTx(async (txRepo) => {
    await txRepo.invalidateUnusedAuthTokens('email_verification', user.id, now);
    return createEmailVerificationTokenInRepo(txRepo, user.id, now);
  });

  if (options.sendEmail === undefined) {
    return { ok: false, code: 'EMAIL_SEND_FAILED', error: 'Email service is not configured' };
  }

  const verifyUrl = `${options.appBaseUrl}/auth/confirm-email?token=${plainToken}`;
  const template = options.emailTemplates.emailVerification(verifyUrl);
  try {
    const res = await options.sendEmail({
      to: user.email,
      subject: template.subject,
      text: template.text ?? '',
      html: template.html ?? '',
    });
    if (!res.success) {
      return { ok: false, code: 'EMAIL_SEND_FAILED', error: res.error ?? 'Failed to send email' };
    }
  } catch (err: unknown) {
    return {
      ok: false,
      code: 'EMAIL_SEND_FAILED',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return { ok: true, sent: true };
}

export async function verifyEmailInRepo(options: {
  readonly repo: Pick<IdentityRepository, 'findValidAuthTokenByHash'>;
  readonly runInTx: <T>(
    fn: (
      txRepo: Pick<
        IdentityRepository,
        'updateUser' | 'consumeAuthTokenById' | 'insertRefreshToken' | 'insertUserSession'
      >,
    ) => Promise<T>,
  ) => Promise<T>;
  readonly token: string;
  readonly jwtSecret: string;
  readonly accessTokenExpiry: string;
  readonly refreshExpiryDays: number;
  readonly cookieConfig: RefreshCookieConfig;
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly now?: Date | undefined;
}): Promise<
  | { readonly ok: true; readonly issued: IssuedSession }
  | { readonly ok: false; readonly code: 'INVALID_TOKEN'; readonly message: string }
> {
  const now = options.now ?? new Date();
  const tokenHash = hashToken(options.token);
  const tokenRecord = await options.repo.findValidAuthTokenByHash(
    'email_verification',
    tokenHash,
    now,
  );
  if (tokenRecord === null || tokenRecord.userId === null) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Invalid or expired verification token' };
  }
  const verifiedUserId = tokenRecord.userId;

  const txResult = await options.runInTx(async (txRepo) => {
    const updatedUser = await txRepo.updateUser(verifiedUserId, {
      emailVerified: true,
      emailVerifiedAt: now,
    });
    if (updatedUser === null) {
      return null;
    }
    const consumed = await txRepo.consumeAuthTokenById(tokenRecord.id, now);
    if (consumed === null) {
      return null;
    }
    return issueSession(txRepo, updatedUser, {
      jwtSecret: options.jwtSecret,
      accessTokenExpiry: options.accessTokenExpiry,
      refreshExpiryDays: options.refreshExpiryDays,
      cookie: options.cookieConfig,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      now,
    });
  });

  if (txResult === null) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Invalid or expired verification token' };
  }
  invalidateLiveness(verifiedUserId);

  return { ok: true, issued: txResult };
}

// ============================================================================
// 5. Registration & Password Login
// ============================================================================

export async function registerUserInRepo(options: {
  readonly repo: Pick<
    IdentityRepository,
    'findUserByEmail' | 'findUserByUsername' | 'invalidateUnusedAuthTokens' | 'insertAuthToken'
  >;
  readonly runInTx: <T>(
    fn: (
      txRepo: Pick<
        IdentityRepository,
        'createUser' | 'invalidateUnusedAuthTokens' | 'insertAuthToken'
      >,
      tx: Tx,
    ) => Promise<T>,
  ) => Promise<T>;
  readonly email: string;
  readonly password: string;
  readonly username: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly tosAccepted: boolean;
  readonly eligibilityAttested: boolean;
  readonly argon2Config: Argon2Config;
  readonly autoVerifyEmail: boolean;
  readonly appBaseUrl: string;
  readonly emailTemplates: AuthEmailTemplates;
  readonly sendEmail?: IdentityEmailSendFn | undefined;
  readonly peekAgreements: SignupComplianceHooks['peekAgreements'];
  readonly recordConsents: SignupComplianceHooks['recordConsents'];
  readonly onUserCreatedInTx?: ((tx: Tx, user: DbUser) => Promise<void>) | undefined;
  readonly onWarn?: ((context: Record<string, unknown>, msg: string) => void) | undefined;
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly now?: Date | undefined;
}): Promise<
  | {
      readonly ok: true;
      readonly value: RegisterResponse;
      readonly createdUser?: DbUser | undefined;
    }
  | {
      readonly ok: false;
      readonly code:
        | 'SIGNUP_CONSENT_REQUIRED'
        | 'ELIGIBILITY_ATTESTATION_REQUIRED'
        | 'RESERVED_EMAIL_DOMAIN'
        | 'USERNAME_TAKEN'
        | 'WEAK_PASSWORD';
      readonly message: string;
      readonly details?: Record<string, unknown> | undefined;
    }
> {
  const now = options.now ?? new Date();
  if (isReservedAnonymizedEmail(options.email)) {
    return {
      ok: false,
      code: 'RESERVED_EMAIL_DOMAIN',
      message: 'This email address cannot be used',
      details: { errors: [{ field: 'email', message: 'This email address cannot be used' }] },
    };
  }

  const normalizedEmail = normalizeEmail(options.email);
  const canonicalEmail = canonicalizeEmail(options.email);

  const existingUser = await options.repo.findUserByEmail(canonicalEmail);
  if (existingUser !== null) {
    if (!existingUser.emailVerified && options.appBaseUrl !== '') {
      const resent = await resendVerificationEmailInRepo({
        repo: options.repo,
        runInTx: (fn) => options.runInTx((txRepo) => fn(txRepo)),
        email: existingUser.email,
        appBaseUrl: options.appBaseUrl,
        emailTemplates: options.emailTemplates,
        sendEmail: options.sendEmail,
        now,
      });
      if (!resent.ok) {
        options.onWarn?.(
          { reason: resent.error },
          'Registration: failed to resend verification email for existing unverified account',
        );
      }
    } else if (options.sendEmail !== undefined) {
      const template = options.emailTemplates.existingAccountRegistrationAttempt(
        existingUser.email,
      );
      try {
        const sent = await options.sendEmail({
          to: existingUser.email,
          subject: template.subject,
          text: template.text ?? '',
          html: template.html ?? '',
        });
        if (!sent.success) {
          options.onWarn?.(
            { reason: sent.error ?? 'unknown send failure' },
            'Registration: failed to send existing-account notification email',
          );
        }
      } catch (err: unknown) {
        options.onWarn?.(
          { reason: err instanceof Error ? err.message : String(err) },
          'Registration: failed to send existing-account notification email',
        );
      }
    }
    return {
      ok: true,
      value: {
        status: 'pending_verification',
        message: REGISTER_PENDING_MESSAGE,
        email: normalizedEmail,
      },
    };
  }

  const existingUsername = await options.repo.findUserByUsername(options.username);
  if (existingUsername !== null) {
    return {
      ok: false,
      code: 'USERNAME_TAKEN',
      message: 'Username is already taken',
    };
  }

  const pwCheck = validatePassword(options.password, [
    normalizedEmail,
    options.username,
    options.firstName,
    options.lastName,
  ]);
  if (!pwCheck.isValid) {
    return {
      ok: false,
      code: 'WEAK_PASSWORD',
      message: 'Password is too weak',
      details: { errors: pwCheck.errors },
    };
  }

  const passwordHash = await hashPassword(options.password, options.argon2Config);
  const autoVerify = options.autoVerifyEmail;

  let createdUser: DbUser;
  let verificationToken: string | null = null;
  try {
    const out = await options.runInTx(async (txRepo, tx) => {
      const newUser = await createConsentedUserInRepo(
        txRepo,
        {
          email: normalizedEmail,
          canonicalEmail,
          username: options.username,
          firstName: options.firstName,
          lastName: options.lastName,
          passwordHash,
          role: 'user',
          emailVerified: autoVerify,
          ...(autoVerify ? { emailVerifiedAt: now } : {}),
        },
        {
          agreed: options.tosAccepted,
          attested: options.eligibilityAttested,
          ...(options.ipAddress !== undefined && options.ipAddress !== null
            ? { ipAddress: options.ipAddress }
            : {}),
          ...(options.userAgent !== undefined && options.userAgent !== null
            ? { userAgent: options.userAgent }
            : {}),
        },
        { peekAgreements: options.peekAgreements, recordConsents: options.recordConsents },
        tx,
        now,
      );
      const tok = autoVerify
        ? null
        : await createEmailVerificationTokenInRepo(txRepo, newUser.id, now);
      if (options.onUserCreatedInTx !== undefined) {
        await options.onUserCreatedInTx(tx, newUser);
      }
      return { newUser, tok };
    });
    createdUser = out.newUser;
    verificationToken = out.tok;
  } catch (err: unknown) {
    if (err instanceof ConsentedUserRefusalError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }

  if (autoVerify) {
    return {
      ok: true,
      value: {
        status: 'verified',
        message: 'Account created. Signing you in…',
        email: createdUser.email,
      },
      createdUser,
    };
  }

  if (options.sendEmail === undefined || verificationToken === null) {
    return {
      ok: true,
      value: {
        status: 'pending_verification',
        message:
          'Account created successfully, but we had trouble sending the verification email. Please use the resend verification option.',
        email: createdUser.email,
        emailSendFailed: true,
      },
      createdUser,
    };
  }

  const verifyUrl = `${options.appBaseUrl}/auth/confirm-email?token=${verificationToken}`;
  const template = options.emailTemplates.emailVerification(verifyUrl);
  try {
    const sent = await options.sendEmail({
      to: normalizedEmail,
      subject: template.subject,
      text: template.text ?? '',
      html: template.html ?? '',
    });
    if (!sent.success) {
      throw new Error(sent.error ?? 'Unknown email error');
    }
  } catch {
    return {
      ok: true,
      value: {
        status: 'pending_verification',
        message:
          'Account created successfully, but we had trouble sending the verification email. Please use the resend verification option.',
        email: createdUser.email,
        emailSendFailed: true,
      },
      createdUser,
    };
  }

  return {
    ok: true,
    value: {
      status: 'pending_verification',
      message: REGISTER_PENDING_MESSAGE,
      email: createdUser.email,
    },
    createdUser,
  };
}

type AuthenticateUserOutcome =
  | {
      readonly ok: true;
      readonly kind: 'authenticated';
      readonly issued: IssuedSession;
      readonly dbUser: DbUser;
      readonly needsPasswordRehash: boolean;
    }
  | {
      readonly ok: true;
      readonly kind: 'totp';
      readonly challenge: TotpLoginChallengeResponse;
      readonly dbUser: DbUser;
      readonly needsPasswordRehash: boolean;
    }
  | {
      readonly ok: true;
      readonly kind: 'sms';
      readonly challenge: SmsLoginChallengeResponse;
      readonly dbUser: DbUser;
      readonly needsPasswordRehash: boolean;
    }
  | {
      readonly ok: false;
      readonly code:
        'ACCOUNT_LOCKED' | 'TOO_MANY_ATTEMPTS' | 'INVALID_CREDENTIALS' | 'EMAIL_NOT_VERIFIED';
      readonly message: string;
      readonly email?: string | undefined;
      readonly becameLocked?: boolean | undefined;
      readonly details?: Record<string, unknown> | undefined;
    };

export async function authenticateUserInRepo(options: {
  readonly repo: Pick<
    IdentityRepository,
    | 'findUserByEmail'
    | 'findUserByUsername'
    | 'countRecentFailedLoginAttempts'
    | 'findMostRecentFailedLoginAttemptAt'
    | 'insertLoginAttempt'
    | 'unlockUserAccount'
  >;
  readonly runInTx: <T>(
    fn: (
      txRepo: Pick<
        IdentityRepository,
        'insertLoginAttempt' | 'insertRefreshToken' | 'insertUserSession'
      >,
    ) => Promise<T>,
  ) => Promise<T>;
  readonly identifier: string;
  readonly password: string;
  readonly jwtSecret: string;
  readonly accessTokenExpiry: string;
  readonly spanDays: number;
  readonly cookieConfig?: RefreshCookieConfig | undefined;
  readonly argon2Config?: Argon2Config | undefined;
  readonly lockoutConfig: LockoutConfig;
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly deviceId?: string | undefined;
  readonly now?: Date | undefined;
}): Promise<AuthenticateUserOutcome> {
  const now = options.now ?? new Date();
  const argon2Cfg = options.argon2Config ?? DEFAULT_ARGON2_CONFIG;
  const cookieCfg = options.cookieConfig ?? {
    httpOnly: true,
    secure: false,
    sameSite: 'lax' as const,
    path: '/',
  };

  const isEmail = options.identifier.includes('@');
  const normalizedIdentifier = isEmail ? normalizeEmail(options.identifier) : options.identifier;
  const canonicalIdentifier = isEmail ? canonicalizeEmail(options.identifier) : options.identifier;
  const user = isEmail
    ? await options.repo.findUserByEmail(canonicalIdentifier)
    : await options.repo.findUserByUsername(normalizedIdentifier);

  const lockoutKey = user?.email ?? (isEmail ? canonicalIdentifier : normalizedIdentifier);

  if (await isAccountLockedInRepo(options.repo, lockoutKey, options.lockoutConfig, now)) {
    await options.repo.insertLoginAttempt({
      email: lockoutKey,
      success: false,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      failureReason: 'ACCOUNT_LOCKED',
    });
    return {
      ok: false,
      code: 'ACCOUNT_LOCKED',
      message: 'Account temporarily locked',
      becameLocked: true,
    };
  }

  const delayMs = await getProgressiveDelayInRepo(
    options.repo,
    lockoutKey,
    options.lockoutConfig,
    now,
  );
  if (delayMs > 0) {
    const retryAfterSeconds = Math.max(1, Math.ceil(delayMs / 1000));
    return {
      ok: false,
      code: 'TOO_MANY_ATTEMPTS',
      message: `Too many login attempts. Please try again in ${String(retryAfterSeconds)} seconds.`,
      details: { retryAfterMs: delayMs },
    };
  }

  const isValid = await verifyPasswordSafe(options.password, user?.passwordHash, argon2Cfg);

  if (user === null) {
    const { becameLocked } = await recordFailedLoginAttempt(
      options.repo,
      lockoutKey,
      'USER_NOT_FOUND',
      options.lockoutConfig,
      options.ipAddress,
      options.userAgent,
      now,
    );
    return {
      ok: false,
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
      becameLocked,
    };
  }

  if (!isValid) {
    const { becameLocked } = await recordFailedLoginAttempt(
      options.repo,
      lockoutKey,
      'PASSWORD_MISMATCH',
      options.lockoutConfig,
      options.ipAddress,
      options.userAgent,
      now,
    );
    return {
      ok: false,
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
      becameLocked,
    };
  }

  if (user.lockedUntil !== null) {
    if (user.lockedUntil > now) {
      await options.repo.insertLoginAttempt({
        email: lockoutKey,
        success: false,
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
        failureReason: 'ACCOUNT_LOCKED',
      });
      return {
        ok: false,
        code: 'ACCOUNT_LOCKED',
        message: 'Account temporarily locked',
        becameLocked: true,
        details: {
          lockedUntil: user.lockedUntil.toISOString(),
          ...(user.lockReason !== null ? { lockReason: user.lockReason } : {}),
        },
      };
    }
    invalidateLiveness(user.id);
    await options.repo.unlockUserAccount(user.id);
  }

  const isActive = getAccountStatus(user) === 'active';
  if (!isActive && !canReactivate(user, now)) {
    await options.repo.insertLoginAttempt({
      email: lockoutKey,
      success: false,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      failureReason: 'ACCOUNT_DELETED',
    });
    return {
      ok: false,
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    };
  }

  if (!user.emailVerified) {
    await options.repo.insertLoginAttempt({
      email: lockoutKey,
      success: false,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      failureReason: 'UNVERIFIED_EMAIL',
    });
    return {
      ok: false,
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Please verify your email address',
      email: user.email,
      details: { email: user.email },
    };
  }

  const rehashNeeded = needsRehash(user.passwordHash, argon2Cfg);

  if (user.totpEnabled) {
    await options.repo.insertLoginAttempt({
      email: lockoutKey,
      success: true,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      failureReason: 'TOTP_REQUIRED',
    });
    return {
      ok: true,
      kind: 'totp',
      dbUser: user,
      needsPasswordRehash: rehashNeeded,
      challenge: {
        requiresTotp: true,
        challengeToken: createChallengeToken(user.id, 'totp_challenge', options.jwtSecret, '5m'),
        message: 'Two-factor authentication required. Please enter your TOTP code.',
      },
    };
  }

  if (user.phoneVerified === true) {
    await options.repo.insertLoginAttempt({
      email: lockoutKey,
      success: true,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      failureReason: 'SMS_REQUIRED',
    });
    return {
      ok: true,
      kind: 'sms',
      dbUser: user,
      needsPasswordRehash: rehashNeeded,
      challenge: {
        requiresSms: true,
        challengeToken: createChallengeToken(user.id, 'sms_challenge', options.jwtSecret, '5m'),
        message: 'SMS verification required. Please request a code.',
      },
    };
  }

  const issued = await options.runInTx(async (txRepo) => {
    await txRepo.insertLoginAttempt({
      email: lockoutKey,
      success: true,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
    });
    return issueSession(txRepo, user, {
      jwtSecret: options.jwtSecret,
      accessTokenExpiry: options.accessTokenExpiry,
      refreshExpiryDays: options.spanDays,
      cookie: cookieCfg,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      deviceId: options.deviceId,
      now,
    });
  });

  return {
    ok: true,
    kind: 'authenticated',
    issued,
    dbUser: user,
    needsPasswordRehash: rehashNeeded,
  };
}

function normalizeDeviceMeta(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}

function sameLoginDevice(
  family: RefreshTokenFamilyView,
  deviceId: string | undefined,
  ipAddress: string | null | undefined,
  userAgent: string | null | undefined,
): boolean {
  const familyDeviceId = normalizeDeviceMeta(family.deviceId);
  if (deviceId !== undefined && familyDeviceId !== null) {
    return familyDeviceId === deviceId;
  }
  const familyIp = normalizeDeviceMeta(family.ipAddress);
  const familyUa = normalizeDeviceMeta(family.userAgent);
  return (
    familyIp !== null &&
    familyUa !== null &&
    familyIp === normalizeDeviceMeta(ipAddress) &&
    familyUa === normalizeDeviceMeta(userAgent)
  );
}

export async function enforcePostLoginSessionHygieneInRepo(
  repo: Pick<
    IdentityRepository,
    | 'findActiveTokenFamilies'
    | 'stampRefreshFamilyRevoked'
    | 'deleteRefreshTokensByFamily'
    | 'revokeUserSessionById'
  >,
  options: {
    readonly userId: string;
    readonly currentFamilyId: string;
    readonly maxConcurrentSessions: number;
    readonly deviceId?: string | undefined;
    readonly ipAddress?: string | null | undefined;
    readonly userAgent?: string | null | undefined;
    readonly now?: Date | undefined;
  },
): Promise<void> {
  const now = options.now ?? new Date();
  const families = await repo.findActiveTokenFamilies(options.userId);
  const current = families.find((f) => f.familyId === options.currentFamilyId);
  if (current !== undefined) {
    const currentTime = current.familyCreatedAt.getTime();
    for (const family of families) {
      if (family.familyId === options.currentFamilyId) continue;
      if (family.familyCreatedAt.getTime() > currentTime) continue;
      if (!sameLoginDevice(family, options.deviceId, options.ipAddress, options.userAgent)) {
        continue;
      }
      await revokeTokenFamilyInRepo(
        repo,
        family.familyId,
        'Superseded by newer login on same device',
        now,
      );
    }
  }

  const remaining = await repo.findActiveTokenFamilies(options.userId);
  if (options.maxConcurrentSessions > 0 && remaining.length > options.maxConcurrentSessions) {
    const sorted = [...remaining].sort(
      (a, b) => a.familyCreatedAt.getTime() - b.familyCreatedAt.getTime(),
    );
    const toEvict = sorted.slice(0, remaining.length - options.maxConcurrentSessions);
    for (const family of toEvict) {
      await repo.stampRefreshFamilyRevoked(family.familyId, 'Session limit exceeded', now);
    }
  }
}

// ============================================================================
// 6. Refresh Token Rotation & Reuse Detection
// ============================================================================

export async function rotateRefreshTokenInRepo(options: {
  readonly repo: Pick<
    IdentityRepository,
    | 'findValidRefreshToken'
    | 'findUserById'
    | 'findUserSessionById'
    | 'findActiveRefreshTokenInFamily'
    | 'stampRefreshFamilyRevoked'
    | 'deleteRefreshTokensByFamily'
    | 'revokeUserSessionById'
    | 'touchUserSession'
  >;
  readonly runInTx: <T>(
    fn: (
      txRepo: Pick<IdentityRepository, 'markRefreshTokenRotated' | 'insertRefreshToken'>,
    ) => Promise<T>,
  ) => Promise<T>;
  readonly oldToken: string;
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly expiryDays: number;
  readonly gracePeriodSeconds: number;
  readonly now?: Date | undefined;
}): Promise<
  | { readonly ok: true; readonly token: string; readonly user: DbUser }
  | {
      readonly ok: false;
      readonly kind: 'invalid' | 'reuse';
      readonly userId?: string | undefined;
      readonly email?: string | undefined;
    }
> {
  const now = options.now ?? new Date();
  const storedToken = await options.repo.findValidRefreshToken(options.oldToken, now);
  if (storedToken === null) {
    return { ok: false, kind: 'invalid' };
  }

  const [user, session] = await Promise.all([
    options.repo.findUserById(storedToken.userId),
    options.repo.findUserSessionById(storedToken.familyId),
  ]);
  if (user === null) {
    return { ok: false, kind: 'invalid' };
  }

  if (
    session?.userAgent !== undefined &&
    session.userAgent !== null &&
    session.userAgent !== '' &&
    options.userAgent !== undefined &&
    options.userAgent !== null &&
    session.userAgent !== options.userAgent
  ) {
    await revokeTokenFamilyInRepo(
      options.repo,
      storedToken.familyId,
      'Session hijacking detected: User-Agent mismatch',
      now,
    );
    return { ok: false, kind: 'reuse', userId: user.id, email: user.email };
  }

  if (storedToken.familyRevokedAt !== null) {
    await revokeTokenFamilyInRepo(options.repo, storedToken.familyId, 'Token reuse detected', now);
    return { ok: false, kind: 'reuse', userId: user.id, email: user.email };
  }

  if (storedToken.rotatedAt !== null) {
    const sinceRotationMs = now.getTime() - storedToken.rotatedAt.getTime();
    if (sinceRotationMs < options.gracePeriodSeconds * MS_PER_SECOND) {
      const active = await options.repo.findActiveRefreshTokenInFamily(storedToken.familyId, now);
      if (active === null) {
        return { ok: false, kind: 'invalid' };
      }
      return { ok: true, token: active.token, user };
    }

    await revokeTokenFamilyInRepo(
      options.repo,
      storedToken.familyId,
      'Token reuse detected outside grace period',
      now,
    );
    return { ok: false, kind: 'reuse', userId: user.id, email: user.email };
  }

  const newToken = await options.runInTx(async (txRepo) => {
    const rotated = await txRepo.markRefreshTokenRotated(storedToken.id, now);
    if (rotated === 0) {
      return null;
    }
    const nextToken = createRefreshToken();
    await txRepo.insertRefreshToken({
      userId: storedToken.userId,
      familyId: storedToken.familyId,
      token: nextToken,
      expiresAt: getRefreshTokenExpiry(options.expiryDays, now),
      familyIpAddress: storedToken.familyIpAddress,
      familyUserAgent: storedToken.familyUserAgent,
      familyCreatedAt: storedToken.familyCreatedAt,
    });
    return nextToken;
  });

  if (newToken === null) {
    if (options.gracePeriodSeconds > 0) {
      const active = await options.repo.findActiveRefreshTokenInFamily(storedToken.familyId, now);
      if (active !== null) {
        return { ok: true, token: active.token, user };
      }
    }
    return { ok: false, kind: 'invalid' };
  }

  await options.repo.touchUserSession(storedToken.familyId, now);
  return { ok: true, token: newToken, user };
}

// ============================================================================
// 7. Password Reset, First-Time Set Password & Onboarding
// ============================================================================

export async function resetPasswordInRepo(options: {
  readonly repo: Pick<
    IdentityRepository,
    | 'findValidAuthTokenByHash'
    | 'findUserById'
    | 'stampAllUserRefreshFamiliesRevoked'
    | 'deleteRefreshTokensByUserId'
    | 'revokeAllUserSessions'
  >;
  readonly runInTx: <T>(
    fn: (txRepo: Pick<IdentityRepository, 'updateUser' | 'consumeAuthTokenById'>) => Promise<T>,
  ) => Promise<T>;
  readonly token: string;
  readonly newPassword: string;
  readonly argon2Config: Argon2Config;
  readonly now?: Date | undefined;
}): Promise<
  | { readonly ok: true; readonly user: DbUser }
  | {
      readonly ok: false;
      readonly code: 'INVALID_TOKEN' | 'WEAK_PASSWORD';
      readonly message: string;
      readonly details?: Record<string, unknown> | undefined;
    }
> {
  const now = options.now ?? new Date();
  const tokenHash = hashToken(options.token);
  const tokenRecord = await options.repo.findValidAuthTokenByHash('password_reset', tokenHash, now);
  if (tokenRecord === null || tokenRecord.userId === null) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Invalid or expired reset token' };
  }

  const user = await options.repo.findUserById(tokenRecord.userId);
  if (user === null) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'User not found for the given token' };
  }

  const pwCheck = validatePassword(
    options.newPassword,
    [user.email, user.username, user.firstName, user.lastName].filter(
      (v): v is string => v !== null,
    ),
  );
  if (!pwCheck.isValid) {
    return {
      ok: false,
      code: 'WEAK_PASSWORD',
      message: 'Password is too weak',
      details: { errors: pwCheck.errors },
    };
  }

  const passwordHash = await hashPassword(options.newPassword, options.argon2Config);
  const ResetUserId = tokenRecord.userId;

  await options.runInTx(async (txRepo) => {
    await txRepo.updateUser(ResetUserId, { passwordHash });
    await txRepo.consumeAuthTokenById(tokenRecord.id, now);
  });

  await revokeAllUserTokensInRepo(options.repo, ResetUserId, now);
  return { ok: true, user };
}

export async function setPasswordInRepo(
  repo: Pick<IdentityRepository, 'findUserById' | 'updateUser'>,
  userId: string,
  newPassword: string,
  argon2Config: Argon2Config,
): Promise<
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'INVALID_CREDENTIALS' | 'PASSWORD_ALREADY_SET' | 'WEAK_PASSWORD';
      readonly message: string;
      readonly details?: Record<string, unknown> | undefined;
    }
> {
  const user = await repo.findUserById(userId);
  if (user === null) {
    return { ok: false, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' };
  }
  if (hasPassword(user.passwordHash)) {
    return {
      ok: false,
      code: 'PASSWORD_ALREADY_SET',
      message: 'User already has a password set',
    };
  }
  const pwCheck = validatePassword(
    newPassword,
    [user.email, user.username, user.firstName, user.lastName].filter(
      (v): v is string => v !== null,
    ),
  );
  if (!pwCheck.isValid) {
    return {
      ok: false,
      code: 'WEAK_PASSWORD',
      message: 'Password is too weak',
      details: { errors: pwCheck.errors },
    };
  }
  const passwordHash = await hashPassword(newPassword, argon2Config);
  await repo.updateUser(userId, { passwordHash });
  return { ok: true };
}

export async function completeOnboardingInRepo(
  viewerRepo: Pick<IdentityRepository, 'findUserById' | 'updateUser'>,
  systemRepo: Pick<IdentityRepository, 'findUserByUsername'>,
  userId: string,
  input: CompleteOnboardingRequest,
  argon2Config: Argon2Config,
): Promise<
  | { readonly ok: true; readonly user: User }
  | {
      readonly ok: false;
      readonly code:
        'INVALID_CREDENTIALS' | 'ONBOARDING_ALREADY_COMPLETE' | 'USERNAME_TAKEN' | 'WEAK_PASSWORD';
      readonly message: string;
      readonly details?: Record<string, unknown> | undefined;
    }
> {
  const user = await viewerRepo.findUserById(userId);
  if (user === null) {
    return { ok: false, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' };
  }
  if (hasPassword(user.passwordHash)) {
    return {
      ok: false,
      code: 'ONBOARDING_ALREADY_COMPLETE',
      message: 'Onboarding has already been completed',
    };
  }

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const username = input.username.trim();

  const existing = await systemRepo.findUserByUsername(username);
  if (existing !== null && existing.id !== userId) {
    return { ok: false, code: 'USERNAME_TAKEN', message: 'Username is already taken' };
  }

  const pwCheck = validatePassword(input.password, [user.email, username, firstName, lastName]);
  if (!pwCheck.isValid) {
    return {
      ok: false,
      code: 'WEAK_PASSWORD',
      message: 'Password is too weak',
      details: { errors: pwCheck.errors },
    };
  }

  const passwordHash = await hashPassword(input.password, argon2Config);
  const updated = await viewerRepo.updateUser(userId, {
    firstName,
    lastName,
    username,
    passwordHash,
  });
  if (updated === null) {
    return { ok: false, code: 'INVALID_CREDENTIALS', message: 'Failed to complete onboarding' };
  }

  return { ok: true, user: toUserDto(updated) };
}

// ============================================================================
// 8. Magic Link & Email OTP Passwordless Flows
// ============================================================================

export async function requestMagicLinkInRepo(options: {
  readonly repo: Pick<
    IdentityRepository,
    'countRecentAuthTokensByEmail' | 'countRecentAuthTokensByIp' | 'insertAuthToken'
  >;
  readonly email: string;
  readonly appBaseUrl: string;
  readonly emailTemplates: AuthEmailTemplates;
  readonly sendEmail?: IdentityEmailSendFn | undefined;
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly tokenExpiryMinutes?: number | undefined;
  readonly maxAttemptsPerEmail?: number | undefined;
  readonly maxAttemptsPerIp?: number | undefined;
  readonly onEmailError?: ((error: string) => void) | undefined;
  readonly now?: Date | undefined;
}): Promise<
  | { readonly ok: true; readonly value: { readonly success: true; readonly message: string } }
  | { readonly ok: false; readonly code: 'TOO_MANY_ATTEMPTS'; readonly message: string }
> {
  const now = options.now ?? new Date();
  const expiryMinutes = options.tokenExpiryMinutes ?? DEFAULT_MAGIC_LINK_EXPIRY_MINUTES;
  const maxPerEmail = options.maxAttemptsPerEmail ?? DEFAULT_MAGIC_LINK_MAX_PER_EMAIL;
  const maxPerIp = options.maxAttemptsPerIp ?? DEFAULT_MAGIC_LINK_MAX_PER_IP;

  const normalizedEmail = normalizeEmail(options.email);
  const canonicalEmail = canonicalizeEmail(options.email);
  const windowStart = new Date(now.getTime() - MS_PER_HOUR);

  const emailCount = await options.repo.countRecentAuthTokensByEmail(
    canonicalEmail,
    windowStart,
    'magic_link',
  );
  if (emailCount >= maxPerEmail) {
    return {
      ok: false,
      code: 'TOO_MANY_ATTEMPTS',
      message: 'Too many magic link requests. Please try again later.',
    };
  }

  if (options.ipAddress !== undefined && options.ipAddress !== null && options.ipAddress !== '') {
    const ipCount = await options.repo.countRecentAuthTokensByIp(
      options.ipAddress,
      windowStart,
      'magic_link',
    );
    if (ipCount >= maxPerIp) {
      return {
        ok: false,
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Too many requests from this location. Please try again later.',
      };
    }
  }

  const token = generateBase64UrlToken(MAGIC_LINK_TOKEN_BYTES);
  const tokenHash = hashToken(token);
  const expiresAt = new Date(now.getTime() + expiryMinutes * MS_PER_MINUTE);

  await options.repo.insertAuthToken({
    type: 'magic_link',
    email: canonicalEmail,
    tokenHash,
    expiresAt,
    ipAddress: options.ipAddress ?? null,
    userAgent: options.userAgent ?? null,
  });

  if (options.sendEmail !== undefined) {
    const magicLinkUrl = `${options.appBaseUrl}/auth/magic-link?token=${token}`;
    const template = options.emailTemplates.magicLink(magicLinkUrl, expiryMinutes);
    try {
      const sent = await options.sendEmail({
        to: normalizedEmail,
        subject: template.subject,
        text: template.text ?? '',
        html: template.html ?? '',
      });
      if (!sent.success) {
        options.onEmailError?.(sent.error ?? 'Failed to send magic link email');
      }
    } catch (err: unknown) {
      options.onEmailError?.(err instanceof Error ? err.message : String(err));
    }
  }

  return {
    ok: true,
    value: {
      success: true,
      message: 'If an account exists with this email, a magic link has been sent.',
    },
  };
}

export async function verifyMagicLinkInRepo(options: {
  readonly runInTx: <T>(
    fn: (
      txRepo: Pick<
        IdentityRepository,
        | 'findValidAuthTokenByHash'
        | 'consumeValidAuthTokenByHash'
        | 'findUserByEmail'
        | 'findUserByUsername'
        | 'createUser'
        | 'updateUser'
        | 'insertRefreshToken'
        | 'insertUserSession'
      >,
      tx: Tx,
    ) => Promise<T>,
  ) => Promise<T>;
  readonly token: string;
  readonly eligibilityAttested?: boolean | undefined;
  readonly tosAccepted?: boolean | undefined;
  readonly jwtSecret: string;
  readonly accessTokenExpiry: string;
  readonly refreshExpiryDays: number;
  readonly cookieConfig: RefreshCookieConfig;
  readonly peekAgreements: SignupComplianceHooks['peekAgreements'];
  readonly recordConsents: SignupComplianceHooks['recordConsents'];
  readonly onUserCreatedInTx?: ((tx: Tx, newUser: DbUser) => Promise<void>) | undefined;
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly now?: Date | undefined;
}): Promise<
  | {
      readonly ok: true;
      readonly response: MagicLinkVerifyResponse;
      readonly issued: IssuedSession;
      readonly createdUser?: DbUser | undefined;
    }
  | {
      readonly ok: false;
      readonly code:
        | 'ACCOUNT_LOCKED'
        | 'ELIGIBILITY_ATTESTATION_REQUIRED'
        | 'SIGNUP_CONSENT_REQUIRED'
        | 'INVALID_TOKEN';
      readonly message: string;
      readonly details?: Record<string, unknown> | undefined;
    }
> {
  const now = options.now ?? new Date();
  const tokenHash = hashToken(options.token);

  const txOutcome = await options.runInTx(async (txRepo, tx) => {
    if (
      !isAttestationConfirmed(options.eligibilityAttested) ||
      !isConsentConfirmed(options.tosAccepted)
    ) {
      const pending = await txRepo.findValidAuthTokenByHash('magic_link', tokenHash, now);
      if (pending !== null && pending.email !== null) {
        const existing = await txRepo.findUserByEmail(pending.email);
        if (existing === null) {
          if (!isAttestationConfirmed(options.eligibilityAttested)) {
            return { ok: false as const, kind: 'attestation' as const };
          }
          const docs = await options.peekAgreements(tx);
          if (docs.length > 0) {
            return { ok: false as const, kind: 'consent' as const };
          }
        }
      }
    }

    const consumed = await txRepo.consumeValidAuthTokenByHash('magic_link', tokenHash, now);
    if (consumed === null || consumed.email === null) {
      return { ok: false as const, kind: 'invalid' as const };
    }

    let user = await txRepo.findUserByEmail(consumed.email);

    if (user !== null) {
      if (user.lockedUntil !== null && user.lockedUntil > now) {
        return {
          ok: false as const,
          kind: 'locked' as const,
          lockedUntil: user.lockedUntil,
          lockReason: user.lockReason,
        };
      }
      if (getAccountStatus(user) !== 'active' && !canReactivate(user, now)) {
        return { ok: false as const, kind: 'invalid' as const };
      }
    }

    const isNewUser = user === null;
    if (user === null) {
      const username = await generateUniqueUsernameInRepo(txRepo, consumed.email);
      user = await createConsentedUserInRepo(
        txRepo,
        {
          email: normalizeEmail(consumed.email),
          canonicalEmail: canonicalizeEmail(consumed.email),
          username,
          firstName: 'User',
          lastName: '',
          passwordHash: `magiclink:${randomBytes(32).toString('hex')}`,
          role: 'user',
          emailVerified: true,
          emailVerifiedAt: now,
        },
        {
          agreed: options.tosAccepted,
          attested: options.eligibilityAttested,
          ...(options.ipAddress !== undefined && options.ipAddress !== null
            ? { ipAddress: options.ipAddress }
            : {}),
          ...(options.userAgent !== undefined && options.userAgent !== null
            ? { userAgent: options.userAgent }
            : {}),
        },
        { peekAgreements: options.peekAgreements, recordConsents: options.recordConsents },
        tx,
        now,
      );
      if (options.onUserCreatedInTx !== undefined) {
        await options.onUserCreatedInTx(tx, user);
      }
    } else if (!user.emailVerified) {
      const updated = await txRepo.updateUser(user.id, {
        emailVerified: true,
        emailVerifiedAt: now,
      });
      if (updated !== null) {
        user = updated;
      }
      invalidateLiveness(user.id);
    }

    const issued = await issueSession(txRepo, user, {
      jwtSecret: options.jwtSecret,
      accessTokenExpiry: options.accessTokenExpiry,
      refreshExpiryDays: options.refreshExpiryDays,
      cookie: options.cookieConfig,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      now,
    });

    return { ok: true as const, issued, ...(isNewUser ? { createdUser: user } : {}) };
  });

  if (!txOutcome.ok) {
    if (txOutcome.kind === 'locked') {
      return {
        ok: false,
        code: 'ACCOUNT_LOCKED',
        message: 'Account temporarily locked',
        details: {
          lockedUntil: txOutcome.lockedUntil.toISOString(),
          ...(txOutcome.lockReason !== null ? { lockReason: txOutcome.lockReason } : {}),
        },
      };
    }
    if (txOutcome.kind === 'attestation') {
      return {
        ok: false,
        code: 'ELIGIBILITY_ATTESTATION_REQUIRED',
        message: ELIGIBILITY_ATTESTATION_REQUIRED_MESSAGE,
      };
    }
    if (txOutcome.kind === 'consent') {
      return {
        ok: false,
        code: 'SIGNUP_CONSENT_REQUIRED',
        message: SIGNUP_CONSENT_REQUIRED_MESSAGE,
      };
    }
    return {
      ok: false,
      code: 'INVALID_TOKEN',
      message: 'Invalid or expired magic link',
    };
  }

  return {
    ok: true,
    issued: txOutcome.issued,
    ...(txOutcome.createdUser !== undefined ? { createdUser: txOutcome.createdUser } : {}),
    response: {
      token: txOutcome.issued.token,
      user: txOutcome.issued.user,
    },
  };
}

function hashCodeForEmail(canonicalEmail: string, code: string): string {
  return hashToken(`${canonicalEmail}:${code}`);
}

function readOtpAttempts(metadata: unknown): number {
  if (metadata !== null && typeof metadata === 'object' && 'attempts' in metadata) {
    const val = (metadata as Record<string, unknown>)['attempts'];
    return typeof val === 'number' && Number.isFinite(val) ? val : 0;
  }
  return 0;
}

export async function requestEmailOtpInRepo(options: {
  readonly repo: Pick<
    IdentityRepository,
    | 'countRecentAuthTokensByEmail'
    | 'countRecentAuthTokensByIp'
    | 'invalidateActiveAuthTokensByEmail'
    | 'insertAuthToken'
  >;
  readonly email: string;
  readonly emailTemplates: AuthEmailTemplates;
  readonly sendEmail?: IdentityEmailSendFn | undefined;
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly codeExpiryMinutes?: number | undefined;
  readonly maxAttemptsPerEmail?: number | undefined;
  readonly maxAttemptsPerIp?: number | undefined;
  readonly onEmailError?: ((error: string) => void) | undefined;
  readonly now?: Date | undefined;
}): Promise<
  | { readonly ok: true; readonly value: { readonly message: string } }
  | { readonly ok: false; readonly code: 'TOO_MANY_ATTEMPTS'; readonly message: string }
> {
  const now = options.now ?? new Date();
  const expiryMinutes = options.codeExpiryMinutes ?? DEFAULT_EMAIL_OTP_EXPIRY_MINUTES;
  const maxPerEmail = options.maxAttemptsPerEmail ?? DEFAULT_EMAIL_OTP_MAX_PER_EMAIL;
  const maxPerIp = options.maxAttemptsPerIp ?? DEFAULT_EMAIL_OTP_MAX_PER_IP;

  const normalizedEmail = normalizeEmail(options.email);
  const canonicalEmail = canonicalizeEmail(options.email);
  const windowStart = new Date(now.getTime() - MS_PER_HOUR);

  const emailCount = await options.repo.countRecentAuthTokensByEmail(
    canonicalEmail,
    windowStart,
    'email_otp',
  );
  if (emailCount >= maxPerEmail) {
    return {
      ok: false,
      code: 'TOO_MANY_ATTEMPTS',
      message: 'Too many code requests. Please try again later.',
    };
  }

  if (options.ipAddress !== undefined && options.ipAddress !== null && options.ipAddress !== '') {
    const ipCount = await options.repo.countRecentAuthTokensByIp(
      options.ipAddress,
      windowStart,
      'email_otp',
    );
    if (ipCount >= maxPerIp) {
      return {
        ok: false,
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Too many requests from this location. Please try again later.',
      };
    }
  }

  await options.repo.invalidateActiveAuthTokensByEmail('email_otp', canonicalEmail, now);

  const code = generateNumericCode(EMAIL_OTP_DIGITS);
  const tokenHash = hashCodeForEmail(canonicalEmail, code);
  const expiresAt = new Date(now.getTime() + expiryMinutes * MS_PER_MINUTE);

  await options.repo.insertAuthToken({
    type: 'email_otp',
    email: canonicalEmail,
    tokenHash,
    expiresAt,
    ipAddress: options.ipAddress ?? null,
    userAgent: options.userAgent ?? null,
    metadata: { attempts: 0 },
  });

  if (options.sendEmail !== undefined) {
    const template = options.emailTemplates.emailOtp(code, expiryMinutes);
    try {
      const sent = await options.sendEmail({
        to: normalizedEmail,
        subject: template.subject,
        text: template.text ?? '',
        html: template.html ?? '',
      });
      if (!sent.success) {
        options.onEmailError?.(sent.error ?? 'Failed to send security code email');
      }
    } catch (err: unknown) {
      options.onEmailError?.(err instanceof Error ? err.message : String(err));
    }
  }

  return {
    ok: true,
    value: {
      message: 'If an account exists for this email, a security code has been sent.',
    },
  };
}

export async function verifyEmailOtpInRepo(options: {
  readonly runInTx: <T>(
    fn: (
      txRepo: Pick<
        IdentityRepository,
        | 'findActiveAuthTokenByEmail'
        | 'updateAuthTokenMetadata'
        | 'consumeAuthTokenById'
        | 'findUserByEmail'
        | 'findUserByUsername'
        | 'createUser'
        | 'updateUser'
        | 'insertRefreshToken'
        | 'insertUserSession'
      >,
      tx: Tx,
    ) => Promise<T>,
  ) => Promise<T>;
  readonly email: string;
  readonly code: string;
  readonly eligibilityAttested?: boolean | undefined;
  readonly tosAccepted?: boolean | undefined;
  readonly jwtSecret: string;
  readonly accessTokenExpiry: string;
  readonly refreshExpiryDays: number;
  readonly cookieConfig: RefreshCookieConfig;
  readonly peekAgreements: SignupComplianceHooks['peekAgreements'];
  readonly recordConsents: SignupComplianceHooks['recordConsents'];
  readonly onUserCreatedInTx?: ((tx: Tx, newUser: DbUser) => Promise<void>) | undefined;
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly now?: Date | undefined;
}): Promise<
  | {
      readonly ok: true;
      readonly response: EmailOtpVerifyResponse;
      readonly issued: IssuedSession;
      readonly createdUser?: DbUser | undefined;
    }
  | {
      readonly ok: false;
      readonly code:
        | 'ACCOUNT_LOCKED'
        | 'ELIGIBILITY_ATTESTATION_REQUIRED'
        | 'SIGNUP_CONSENT_REQUIRED'
        | 'INVALID_TOKEN';
      readonly message: string;
      readonly details?: Record<string, unknown> | undefined;
    }
> {
  const now = options.now ?? new Date();
  const canonicalEmail = canonicalizeEmail(options.email);
  const expectedHash = hashCodeForEmail(canonicalEmail, options.code);

  const txOutcome = await options.runInTx(async (txRepo, tx) => {
    const tokenRecord = await txRepo.findActiveAuthTokenByEmail('email_otp', canonicalEmail, now);
    if (tokenRecord === null) {
      return { ok: false as const, kind: 'invalid' as const };
    }

    if (tokenRecord.tokenHash !== expectedHash) {
      const attempts = readOtpAttempts(tokenRecord.metadata) + 1;
      if (attempts >= MAX_OTP_VERIFY_ATTEMPTS) {
        await txRepo.consumeAuthTokenById(tokenRecord.id, now);
      } else {
        await txRepo.updateAuthTokenMetadata(tokenRecord.id, { attempts });
      }
      return { ok: false as const, kind: 'invalid' as const };
    }

    let user = await txRepo.findUserByEmail(canonicalEmail);

    if (user === null) {
      if (!isAttestationConfirmed(options.eligibilityAttested)) {
        return { ok: false as const, kind: 'attestation' as const };
      }
      if (!isConsentConfirmed(options.tosAccepted)) {
        const docs = await options.peekAgreements(tx);
        if (docs.length > 0) {
          return { ok: false as const, kind: 'consent' as const };
        }
      }
    }

    const consumed = await txRepo.consumeAuthTokenById(tokenRecord.id, now);
    if (consumed === null) {
      return { ok: false as const, kind: 'invalid' as const };
    }

    const isNewUser = user === null;

    if (user !== null) {
      if (user.lockedUntil !== null && user.lockedUntil > now) {
        return {
          ok: false as const,
          kind: 'locked' as const,
          lockedUntil: user.lockedUntil,
          lockReason: user.lockReason,
        };
      }
      if (getAccountStatus(user) !== 'active' && !canReactivate(user, now)) {
        return { ok: false as const, kind: 'invalid' as const };
      }
    }

    const targetEmail = tokenRecord.email ?? options.email;
    if (user === null) {
      const username = await generateUniqueUsernameInRepo(txRepo, targetEmail);
      user = await createConsentedUserInRepo(
        txRepo,
        {
          email: normalizeEmail(targetEmail),
          canonicalEmail,
          username,
          firstName: 'User',
          lastName: '',
          passwordHash: `emailotp:${randomBytes(32).toString('hex')}`,
          role: 'user',
          emailVerified: true,
          emailVerifiedAt: now,
        },
        {
          agreed: options.tosAccepted,
          attested: options.eligibilityAttested,
          ...(options.ipAddress !== undefined && options.ipAddress !== null
            ? { ipAddress: options.ipAddress }
            : {}),
          ...(options.userAgent !== undefined && options.userAgent !== null
            ? { userAgent: options.userAgent }
            : {}),
        },
        { peekAgreements: options.peekAgreements, recordConsents: options.recordConsents },
        tx,
        now,
      );
      if (options.onUserCreatedInTx !== undefined) {
        await options.onUserCreatedInTx(tx, user);
      }
    } else if (!user.emailVerified) {
      const updated = await txRepo.updateUser(user.id, {
        emailVerified: true,
        emailVerifiedAt: now,
      });
      if (updated !== null) {
        user = updated;
      }
      invalidateLiveness(user.id);
    }

    const issued = await issueSession(txRepo, user, {
      jwtSecret: options.jwtSecret,
      accessTokenExpiry: options.accessTokenExpiry,
      refreshExpiryDays: options.refreshExpiryDays,
      cookie: options.cookieConfig,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      now,
    });

    return { ok: true as const, issued, isNewUser, ...(isNewUser ? { createdUser: user } : {}) };
  });

  if (!txOutcome.ok) {
    if (txOutcome.kind === 'locked') {
      return {
        ok: false,
        code: 'ACCOUNT_LOCKED',
        message: 'Account temporarily locked',
        details: {
          lockedUntil: txOutcome.lockedUntil.toISOString(),
          ...(txOutcome.lockReason !== null ? { lockReason: txOutcome.lockReason } : {}),
        },
      };
    }
    if (txOutcome.kind === 'attestation') {
      return {
        ok: false,
        code: 'ELIGIBILITY_ATTESTATION_REQUIRED',
        message: ELIGIBILITY_ATTESTATION_REQUIRED_MESSAGE,
      };
    }
    if (txOutcome.kind === 'consent') {
      return {
        ok: false,
        code: 'SIGNUP_CONSENT_REQUIRED',
        message: SIGNUP_CONSENT_REQUIRED_MESSAGE,
      };
    }
    return {
      ok: false,
      code: 'INVALID_TOKEN',
      message: 'Invalid or expired security code',
    };
  }

  return {
    ok: true,
    issued: txOutcome.issued,
    ...(txOutcome.createdUser !== undefined ? { createdUser: txOutcome.createdUser } : {}),
    response: {
      token: txOutcome.issued.token,
      user: txOutcome.issued.user,
      isNewUser: txOutcome.isNewUser,
    },
  };
}

// ============================================================================
// 9. Email Change, Confirmation & Reversion
// ============================================================================

export async function initiateEmailChangeInRepo(options: {
  readonly viewerRepo: Pick<IdentityRepository, 'findUserById'>;
  readonly systemRepo: Pick<
    IdentityRepository,
    'findUserByEmail' | 'invalidateUnusedAuthTokens' | 'insertAuthToken'
  >;
  readonly userId: string;
  readonly newEmail: string;
  readonly password: string;
  readonly argon2Config: Argon2Config;
  readonly appBaseUrl: string;
  readonly emailTemplates: AuthEmailTemplates;
  readonly sendEmail?: IdentityEmailSendFn | undefined;
  readonly onEmailError?: ((err: unknown) => void) | undefined;
  readonly now?: Date | undefined;
}): Promise<
  | { readonly ok: true; readonly value: { readonly success: true; readonly message: string } }
  | {
      readonly ok: false;
      readonly code: 'RESERVED_EMAIL_DOMAIN' | 'INVALID_CREDENTIALS';
      readonly message: string;
    }
> {
  const now = options.now ?? new Date();
  if (isReservedAnonymizedEmail(options.newEmail)) {
    return {
      ok: false,
      code: 'RESERVED_EMAIL_DOMAIN',
      message: 'This email address cannot be used',
    };
  }

  const normalizedNewEmail = normalizeEmail(options.newEmail);
  const canonicalNewEmail = canonicalizeEmail(options.newEmail);

  const user = await options.viewerRepo.findUserById(options.userId);
  if (user === null) {
    return { ok: false, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' };
  }

  const passwordValid = await verifyPasswordSafe(
    options.password,
    user.passwordHash,
    options.argon2Config,
  );
  if (!passwordValid) {
    return { ok: false, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' };
  }

  const existing = await options.systemRepo.findUserByEmail(canonicalNewEmail);
  if (existing !== null && existing.id !== options.userId) {
    return {
      ok: true,
      value: {
        success: true,
        message: 'If the email is available, a verification link has been sent.',
      },
    };
  }

  const { plain, hash } = generateSecureToken();
  const expiresAt = new Date(now.getTime() + EMAIL_CHANGE_HOURS * MS_PER_HOUR);

  await options.systemRepo.invalidateUnusedAuthTokens('email_change', options.userId, now);
  await options.systemRepo.insertAuthToken({
    type: 'email_change',
    userId: options.userId,
    tokenHash: hash,
    expiresAt,
    metadata: { newEmail: normalizedNewEmail },
  });

  if (options.sendEmail !== undefined) {
    const verifyUrl = `${options.appBaseUrl}/auth/change-email/confirm?token=${plain}`;
    const template = options.emailTemplates.emailVerification(verifyUrl, EMAIL_CHANGE_HOURS * 60);
    try {
      await options.sendEmail({
        to: normalizedNewEmail,
        subject: 'Confirm your new email address',
        text: template.text ?? '',
        html: template.html ?? '',
      });
    } catch (err: unknown) {
      options.onEmailError?.(err);
    }
  }

  return {
    ok: true,
    value: {
      success: true,
      message: 'If the email is available, a verification link has been sent.',
    },
  };
}

export async function confirmEmailChangeInRepo(
  repo: Pick<
    IdentityRepository,
    | 'findAuthTokenByHash'
    | 'findUserByEmail'
    | 'findUserById'
    | 'updateUser'
    | 'consumeAuthTokenById'
    | 'invalidateUnusedAuthTokens'
    | 'insertAuthToken'
  >,
  token: string,
  now: Date = new Date(),
): Promise<
  | {
      readonly ok: true;
      readonly value: {
        readonly success: true;
        readonly message: string;
        readonly email: string;
      };
      readonly previousEmail: string;
      readonly revertToken: string;
      readonly userId: string;
    }
  | { readonly ok: false; readonly code: 'INVALID_TOKEN'; readonly message: string }
> {
  const tokenHash = hashToken(token);
  const tokenRecord = await repo.findAuthTokenByHash('email_change', tokenHash);
  if (tokenRecord === null) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Invalid or expired token' };
  }
  if (tokenRecord.usedAt !== null) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Token has already been used' };
  }
  if (tokenRecord.expiresAt < now) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Token has expired' };
  }
  const confirmedUserId = tokenRecord.userId;
  const rawNewEmail = tokenRecord.metadata['newEmail'];
  if (confirmedUserId === null || typeof rawNewEmail !== 'string' || rawNewEmail === '') {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Invalid or expired token' };
  }

  const canonicalNewEmail = canonicalizeEmail(rawNewEmail);
  const existing = await repo.findUserByEmail(canonicalNewEmail);
  if (existing !== null) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Email address is no longer available' };
  }

  const user = await repo.findUserById(confirmedUserId);
  if (user === null) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'User not found' };
  }
  const previousEmail = user.email;

  await repo.updateUser(confirmedUserId, {
    email: rawNewEmail,
    canonicalEmail: canonicalNewEmail,
    updatedAt: now,
  });
  invalidateLiveness(confirmedUserId);
  await repo.consumeAuthTokenById(tokenRecord.id, now);

  const { plain: revertToken, hash: revertHash } = generateSecureToken();
  const revertExpiresAt = new Date(now.getTime() + EMAIL_CHANGE_REVERT_HOURS * MS_PER_HOUR);
  await repo.invalidateUnusedAuthTokens('email_change_revert', confirmedUserId, now);
  await repo.insertAuthToken({
    type: 'email_change_revert',
    userId: confirmedUserId,
    tokenHash: revertHash,
    expiresAt: revertExpiresAt,
    metadata: { oldEmail: previousEmail, newEmail: rawNewEmail },
  });

  return {
    ok: true,
    value: {
      success: true,
      message: 'Email address has been updated successfully.',
      email: rawNewEmail,
    },
    previousEmail,
    revertToken,
    userId: confirmedUserId,
  };
}

export async function revertEmailChangeInRepo(
  repo: Pick<
    IdentityRepository,
    | 'findAuthTokenByHash'
    | 'findUserById'
    | 'updateUser'
    | 'consumeAuthTokenById'
    | 'stampAllUserRefreshFamiliesRevoked'
    | 'deleteRefreshTokensByUserId'
    | 'revokeAllUserSessions'
  >,
  token: string,
  now: Date = new Date(),
): Promise<
  | { readonly ok: true; readonly value: { readonly message: string; readonly email: string } }
  | { readonly ok: false; readonly code: 'INVALID_TOKEN'; readonly message: string }
> {
  const tokenHash = hashToken(token);
  const tokenRecord = await repo.findAuthTokenByHash('email_change_revert', tokenHash);
  if (tokenRecord === null) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Invalid or expired token' };
  }
  if (tokenRecord.usedAt !== null) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Token has already been used' };
  }
  if (tokenRecord.expiresAt < now) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Token has expired' };
  }
  const revertUserId = tokenRecord.userId;
  const oldEmail = tokenRecord.metadata['oldEmail'];
  const newEmail = tokenRecord.metadata['newEmail'];
  if (
    revertUserId === null ||
    typeof oldEmail !== 'string' ||
    oldEmail === '' ||
    typeof newEmail !== 'string' ||
    newEmail === ''
  ) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Invalid or expired token' };
  }

  const user = await repo.findUserById(revertUserId);
  if (user === null) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'User not found' };
  }
  if (normalizeEmail(user.email) !== normalizeEmail(newEmail)) {
    return {
      ok: false,
      code: 'INVALID_TOKEN',
      message: 'Email change already reversed or superseded',
    };
  }

  const lockedUntil = new Date('2099-12-31T23:59:59.999Z');
  await repo.updateUser(revertUserId, {
    email: oldEmail,
    canonicalEmail: canonicalizeEmail(oldEmail),
    lockedUntil,
    updatedAt: now,
  });
  invalidateLiveness(revertUserId);

  await repo.consumeAuthTokenById(tokenRecord.id, now);
  await revokeAllUserTokensInRepo(repo, revertUserId, now);

  return {
    ok: true,
    value: {
      message: 'Email address has been reverted and your account has been locked.',
      email: oldEmail,
    },
  };
}

export function buildRotatedSessionAccessToken(
  user: DbUser,
  jwtSecret: string,
  accessTokenExpiry: string,
): string {
  return createAccessToken(
    user.id,
    user.email,
    user.role,
    jwtSecret,
    accessTokenExpiry,
    user.tokenVersion,
  );
}
