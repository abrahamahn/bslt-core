// main/modules/identity/server/crypto.ts
import {
  argon2,
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

import {
  JwtError,
  sign as jwtSign,
  verify as jwtVerify,
  type VerifyOptions,
} from '@bslt/server-system/security';

import type { UserRole } from '../contract';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const MIN_JWT_SECRET_LENGTH = 32;
export const REFRESH_TOKEN_BYTES = 64;
export const REFRESH_COOKIE_NAME = 'refreshToken';
export const SUDO_TOKEN_HEADER = 'x-sudo-token';
export const SUDO_TOKEN_TTL_MINUTES = 5;
const SUDO_TOKEN_TYPE = 'sudo';

// ============================================================================
// 1. Deterministic Token Hashing & Random Generation
// ============================================================================

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateSecureToken(): { plain: string; hash: string } {
  const plain = randomBytes(32).toString('hex');
  return { plain, hash: hashToken(plain) };
}

export function generateBase64UrlToken(bytes: number = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function generateNumericCode(digits: number = 6): string {
  const max = 10 ** digits;
  return randomInt(0, max).toString().padStart(digits, '0');
}

// ============================================================================
// 2. Argon2id Password Hashing & Timing-Safe Dummy Hash Pool
// ============================================================================

export interface Argon2Config {
  readonly type: 0 | 1 | 2;
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

export const DEFAULT_ARGON2_CONFIG: Argon2Config = {
  type: 2, // argon2id
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

const ALGORITHMS = ['argon2d', 'argon2i', 'argon2id'] as const;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

const PHC_PATTERN =
  /^\$(argon2d|argon2i|argon2id)\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/u;

const deriveArgon2 = promisify(argon2);

interface Argon2Run {
  readonly algorithm: (typeof ALGORITHMS)[number];
  readonly memory: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly salt: Buffer;
}

function derive(password: string, run: Argon2Run, tagLength: number): Promise<Buffer> {
  return deriveArgon2(run.algorithm, {
    message: password,
    nonce: run.salt,
    memory: run.memory,
    passes: run.passes,
    parallelism: run.parallelism,
    tagLength,
  });
}

function parsePhc(hash: string): (Argon2Run & { readonly tag: Buffer }) | null {
  const [, name, memory, passes, parallelism, salt, tag] = PHC_PATTERN.exec(hash) ?? [];
  const algorithm = ALGORITHMS.find((candidate) => candidate === name);
  if (algorithm === undefined || salt === undefined || tag === undefined) return null;
  return {
    algorithm,
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    salt: Buffer.from(salt, 'base64'),
    tag: Buffer.from(tag, 'base64'),
  };
}

const unpaddedBase64 = (bytes: Buffer): string => bytes.toString('base64').replace(/=+$/u, '');

export async function hashPassword(
  password: string,
  config: Argon2Config = DEFAULT_ARGON2_CONFIG,
): Promise<string> {
  const run: Argon2Run = {
    algorithm: ALGORITHMS[config.type],
    memory: config.memoryCost,
    passes: config.timeCost,
    parallelism: config.parallelism,
    salt: randomBytes(SALT_BYTES),
  };
  const tag = await derive(password, run, TAG_BYTES);
  const params = `m=${String(run.memory)},t=${String(run.passes)},p=${String(run.parallelism)}`;
  return `$${run.algorithm}$v=19$${params}$${unpaddedBase64(run.salt)}$${unpaddedBase64(tag)}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parsed = parsePhc(hash);
  if (parsed === null) return false;
  try {
    return timingSafeEqual(await derive(password, parsed, parsed.tag.length), parsed.tag);
  } catch {
    return false;
  }
}

export function needsRehash(hash: string, config: Argon2Config = DEFAULT_ARGON2_CONFIG): boolean {
  const parsed = parsePhc(hash);
  return (
    parsed === null ||
    parsed.memory !== config.memoryCost ||
    parsed.passes !== config.timeCost ||
    parsed.parallelism !== config.parallelism
  );
}

const PASSWORDLESS_HASH_PREFIXES = ['magiclink:', 'emailotp:', 'oauth:'] as const;

export function hasPassword(passwordHash: string): boolean {
  return !PASSWORDLESS_HASH_PREFIXES.some((prefix) => passwordHash.startsWith(prefix));
}

const DUMMY_HASH_POOL_SIZE = 10;
let dummyHashPool: string[] = [];
let poolInitialized = false;

export async function initDummyHashPool(
  config: Argon2Config = DEFAULT_ARGON2_CONFIG,
): Promise<void> {
  if (poolInitialized && dummyHashPool.length === DUMMY_HASH_POOL_SIZE) {
    return;
  }
  const hashPromises: Promise<string>[] = [];
  for (let i = 0; i < DUMMY_HASH_POOL_SIZE; i++) {
    const dummyPassword = `dummy_password_${String(i)}_${randomUUID()}_${randomUUID()}`;
    hashPromises.push(hashPassword(dummyPassword, config));
  }
  dummyHashPool = await Promise.all(hashPromises);
  poolInitialized = true;
}

async function getRandomDummyHash(config: Argon2Config = DEFAULT_ARGON2_CONFIG): Promise<string> {
  if (dummyHashPool.length > 0) {
    const randomIndex = randomInt(dummyHashPool.length);
    return dummyHashPool[randomIndex] as string;
  }
  return hashPassword(`fallback_dummy_${randomUUID()}_${randomUUID()}`, config);
}

export function isDummyHashPoolInitialized(): boolean {
  return poolInitialized && dummyHashPool.length === DUMMY_HASH_POOL_SIZE;
}

export function resetDummyHashPool(): void {
  dummyHashPool = [];
  poolInitialized = false;
}

export async function verifyPasswordSafe(
  password: string,
  hash: string | null | undefined,
  fallbackConfig: Argon2Config = DEFAULT_ARGON2_CONFIG,
): Promise<boolean> {
  const hashToVerify =
    hash !== undefined && hash !== null && hash !== ''
      ? hash
      : await getRandomDummyHash(fallbackConfig);
  const isValid = await verifyPassword(password, hashToVerify);
  return hash !== undefined && hash !== null && hash !== '' ? isValid : false;
}

// ============================================================================
// 3. JWT Access, Refresh & Sudo Tokens
// ============================================================================

export interface TokenPayload {
  userId: string;
  email: string;
  role: UserRole;
  [key: string]: unknown;
}

function isTokenPayload(value: unknown): value is TokenPayload {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['userId'] === 'string' &&
    typeof record['email'] === 'string' &&
    typeof record['role'] === 'string'
  );
}

export function createAccessToken(
  userId: string,
  email: string,
  role: UserRole,
  secret: string,
  expiresIn: string | number = '15m',
  tokenVersion?: number,
): string {
  if (secret === '' || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`JWT secret must be at least ${String(MIN_JWT_SECRET_LENGTH)} characters`);
  }
  const payload: TokenPayload = { userId, email, role };
  if (tokenVersion !== undefined) {
    payload['tokenVersion'] = tokenVersion;
  }
  return jwtSign(payload, secret, { expiresIn });
}

export function verifyToken(token: string, secret: string, options?: VerifyOptions): TokenPayload {
  if (secret === '' || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`JWT secret must be at least ${String(MIN_JWT_SECRET_LENGTH)} characters`);
  }
  const payload: unknown = jwtVerify(token, secret, options);
  if (!isTokenPayload(payload)) {
    throw new JwtError('Invalid token payload', 'INVALID_TOKEN');
  }
  return payload;
}

export function createRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
}

export function getRefreshTokenExpiry(expiryDays: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + expiryDays * MS_PER_DAY);
}

export function createSudoToken(
  userId: string,
  jwtSecret: string,
  ttlMinutes: number = SUDO_TOKEN_TTL_MINUTES,
  now: Date = new Date(),
): { sudoToken: string; expiresAt: string } {
  const expiresIn = ttlMinutes < 0 ? ttlMinutes * 60 : `${String(ttlMinutes)}m`;
  const sudoToken = jwtSign({ userId, type: SUDO_TOKEN_TYPE }, jwtSecret, { expiresIn });
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
  return { sudoToken, expiresAt };
}

export function verifySudoToken(token: string, jwtSecret: string): { userId: string } | null {
  try {
    const payload = jwtVerify(token, jwtSecret);
    if (payload['type'] !== SUDO_TOKEN_TYPE || typeof payload['userId'] !== 'string') {
      return null;
    }
    return { userId: payload['userId'] };
  } catch {
    return null;
  }
}

// ============================================================================
// 4. Liveness Cache
// ============================================================================

export interface LivenessRecord {
  tokenVersion: number;
  lockedUntil: Date | null;
  lockReason: string | null;
  role: string;
  emailVerified?: boolean | undefined;
}

export const LIVENESS_TTL_MS = 10_000;
const MAX_LIVENESS_ENTRIES = 10_000;

interface CacheEntry {
  record: LivenessRecord;
  expiresAt: number;
}

const livenessCache = new Map<string, CacheEntry>();

export function getLiveness(userId: string): LivenessRecord | null {
  const entry = livenessCache.get(userId);
  if (entry === undefined) return null;
  if (entry.expiresAt <= Date.now()) {
    livenessCache.delete(userId);
    return null;
  }
  return entry.record;
}

export function setLiveness(userId: string, record: LivenessRecord): void {
  livenessCache.delete(userId);
  if (livenessCache.size >= MAX_LIVENESS_ENTRIES) {
    const oldest = livenessCache.keys().next();
    if (!oldest.done) livenessCache.delete(oldest.value);
  }
  livenessCache.set(userId, { record, expiresAt: Date.now() + LIVENESS_TTL_MS });
}

export function invalidateLiveness(userId: string): void {
  livenessCache.delete(userId);
}

export function clearLivenessCache(): void {
  livenessCache.clear();
}

// ============================================================================
// 5. Email Canonicalization, User-Agent Device Labeling & Auth Email Templates
// ============================================================================

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function canonicalizeEmail(email: string): string {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.indexOf('@');
  if (atIndex === -1) return normalized;

  let localPart = normalized.substring(0, atIndex);
  const domain = normalized.substring(atIndex + 1);

  const plusIndex = localPart.indexOf('+');
  if (plusIndex !== -1) {
    localPart = localPart.substring(0, plusIndex);
  }

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    localPart = localPart.replace(/\./gu, '');
  }

  return `${localPart}@${domain}`;
}

export interface DeviceInfo {
  deviceName: string | null;
  deviceType: string | null;
}

export function parseUserAgentDeviceInfo(userAgent?: string | null): DeviceInfo {
  if (userAgent == null || userAgent === '') {
    return { deviceName: null, deviceType: null };
  }

  let browser = 'Unknown browser';
  let os = 'Unknown device';

  if (userAgent.includes('OPR') || userAgent.includes('Opera')) {
    browser = 'Opera';
  } else if (userAgent.includes('Edg')) {
    browser = 'Edge';
  } else if (userAgent.includes('Firefox')) {
    browser = 'Firefox';
  } else if (userAgent.includes('Chrome')) {
    browser = 'Chrome';
  } else if (userAgent.includes('Safari')) {
    browser = 'Safari';
  }

  if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
    os = 'iOS';
  } else if (userAgent.includes('Android')) {
    os = 'Android';
  } else if (userAgent.includes('Windows')) {
    os = 'Windows';
  } else if (userAgent.includes('Mac OS') || userAgent.includes('Macintosh')) {
    os = 'macOS';
  } else if (userAgent.includes('Linux')) {
    os = 'Linux';
  }

  let deviceType = 'unknown';
  if (userAgent.includes('iPad')) {
    deviceType = 'tablet';
  } else if (userAgent.includes('iPhone') || userAgent.includes('Android')) {
    deviceType = 'mobile';
  } else if (
    userAgent.includes('Windows') ||
    userAgent.includes('Mac OS') ||
    userAgent.includes('Macintosh') ||
    userAgent.includes('Linux')
  ) {
    deviceType = 'desktop';
  }

  return { deviceName: `${browser} on ${os}`, deviceType };
}

export interface EmailTemplateResult {
  readonly to: string;
  readonly subject: string;
  readonly text?: string | undefined;
  readonly html?: string | undefined;
}

export interface AuthEmailTemplates {
  passwordReset(resetUrl: string, expiresInMinutes?: number): EmailTemplateResult;
  magicLink(loginUrl: string, expiresInMinutes?: number): EmailTemplateResult;
  emailOtp(code: string, expiresInMinutes?: number): EmailTemplateResult;
  emailVerification(verifyUrl: string, expiresInMinutes?: number): EmailTemplateResult;
  existingAccountRegistrationAttempt(email: string): EmailTemplateResult;
  tokenReuseAlert(ipAddress: string, userAgent: string, timestamp: Date): EmailTemplateResult;
  newLoginAlert(ipAddress: string, userAgent: string, timestamp: Date): EmailTemplateResult;
  passwordChangedAlert(ipAddress: string, userAgent: string, timestamp: Date): EmailTemplateResult;
  emailChangedAlert(
    newEmail: string,
    ipAddress: string,
    userAgent: string,
    timestamp: Date,
    revertUrl?: string,
  ): EmailTemplateResult;
  securityNotification(type: string, details: string, actionUrl: string): EmailTemplateResult;
}

export interface AuthEmailTemplateOptions {
  readonly appName?: string | undefined;
}

function renderSimpleEmail(subject: string, text: string): EmailTemplateResult {
  const body = text.trim();
  return {
    to: '',
    subject,
    text: body,
    html: `<p>${body.replace(/\n/gu, '<br>')}</p>`,
  };
}

export function createAuthEmailTemplates(
  options: AuthEmailTemplateOptions = {},
): AuthEmailTemplates {
  const appName =
    typeof options.appName === 'string' && options.appName.trim().length > 0
      ? options.appName.trim()
      : 'Your App';

  return {
    passwordReset(resetUrl, expiresInMinutes = 15) {
      return renderSimpleEmail(
        'Reset your password',
        `Reset your ${appName} password:\n${resetUrl}\n\nThis link expires in ${String(expiresInMinutes)} minutes.`,
      );
    },
    magicLink(loginUrl, expiresInMinutes = 15) {
      return renderSimpleEmail(
        `Sign in to ${appName}`,
        `Use this link to sign in to ${appName}:\n${loginUrl}\n\nThis link expires in ${String(expiresInMinutes)} minutes.`,
      );
    },
    emailOtp(code, expiresInMinutes = 10) {
      return renderSimpleEmail(
        `Your ${appName} security code`,
        `Your ${appName} security code is:\n\n${code}\n\nEnter this code to sign in. It expires in ${String(expiresInMinutes)} minutes.\nIf you didn't request this, you can safely ignore this email.`,
      );
    },
    emailVerification(verifyUrl, expiresInMinutes = 60) {
      return renderSimpleEmail(
        'Verify your email',
        `Verify your ${appName} email address:\n${verifyUrl}\n\nThis link expires in ${String(expiresInMinutes)} minutes.`,
      );
    },
    existingAccountRegistrationAttempt(email) {
      return renderSimpleEmail(
        'Account registration attempted',
        `A registration attempt was made for ${email}. If this was not you, no action is needed.`,
      );
    },
    tokenReuseAlert(ipAddress, userAgent, timestamp) {
      return renderSimpleEmail(
        'Security alert',
        `A reused authentication token was detected.\nIP: ${ipAddress}\nDevice: ${userAgent}\nTime: ${timestamp.toISOString()}`,
      );
    },
    newLoginAlert(ipAddress, userAgent, timestamp) {
      return renderSimpleEmail(
        'New login',
        `A new login was detected.\nIP: ${ipAddress}\nDevice: ${userAgent}\nTime: ${timestamp.toISOString()}`,
      );
    },
    passwordChangedAlert(ipAddress, userAgent, timestamp) {
      return renderSimpleEmail(
        'Password changed',
        `Your password was changed.\nIP: ${ipAddress}\nDevice: ${userAgent}\nTime: ${timestamp.toISOString()}`,
      );
    },
    emailChangedAlert(newEmail, ipAddress, userAgent, timestamp, revertUrl) {
      const revertLine =
        revertUrl !== undefined && revertUrl !== '' ? `\nRevert this change: ${revertUrl}` : '';
      return renderSimpleEmail(
        'Email changed',
        `Your email was changed to ${newEmail}.\nIP: ${ipAddress}\nDevice: ${userAgent}\nTime: ${timestamp.toISOString()}${revertLine}`,
      );
    },
    securityNotification(type, details, actionUrl) {
      return renderSimpleEmail(type, `${details}\n\nReview your account:\n${actionUrl}`);
    },
  };
}

// ============================================================================
// 7. AES-256-GCM Secret Encryption & Challenge JWTs
// ============================================================================

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

export function encryptToken(token: string, encryptionKey: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = scryptSync(encryptionKey, salt, 32);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    salt.toString('base64'),
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export function decryptToken(encryptedData: string, encryptionKey: string): string {
  const [saltB64, ivB64, tagB64, encryptedB64] = encryptedData.split(':');
  if (
    saltB64 === undefined ||
    ivB64 === undefined ||
    tagB64 === undefined ||
    encryptedB64 === undefined
  ) {
    throw new Error('Invalid encrypted token format');
  }

  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');

  const key = scryptSync(encryptionKey, salt, 32);
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function isLegacyPlaintextSecret(stored: string): boolean {
  return !stored.includes(':');
}

export function encryptTotpSecret(secretBase32: string, encryptionKey: string): string {
  return encryptToken(secretBase32, encryptionKey);
}

export function decryptTotpSecret(stored: string, encryptionKey: string): string {
  return isLegacyPlaintextSecret(stored) ? stored : decryptToken(stored, encryptionKey);
}

export type ChallengePurpose = 'totp_challenge' | 'sms_challenge';

export function createChallengeToken(
  userId: string,
  purpose: ChallengePurpose,
  jwtSecret: string,
  expiresIn: string | number = '5m',
): string {
  return jwtSign({ userId, purpose, jti: randomUUID() }, jwtSecret, { expiresIn });
}

export function verifyChallengeToken(
  token: string,
  jwtSecret: string,
  allowedPurposes: readonly ChallengePurpose[],
): {
  readonly userId: string;
  readonly purpose: ChallengePurpose;
  readonly jti: string | null;
  readonly exp: number | null;
} | null {
  try {
    const payload = jwtVerify(token, jwtSecret);
    const purpose = payload['purpose'];
    const userId = payload['userId'];
    if (
      typeof userId !== 'string' ||
      userId === '' ||
      (purpose !== 'totp_challenge' && purpose !== 'sms_challenge') ||
      !allowedPurposes.includes(purpose)
    ) {
      return null;
    }
    return {
      userId,
      purpose,
      jti: typeof payload['jti'] === 'string' ? payload['jti'] : null,
      exp: typeof payload['exp'] === 'number' ? payload['exp'] : null,
    };
  } catch {
    return null;
  }
}
