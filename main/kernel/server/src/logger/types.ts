// main/kernel/server/src/logger/types.ts

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

export type LogMeta = Record<string, unknown>;

export interface LogRequestContext {
  correlationId: string;
  requestId: string;
  method: string;
  path: string;
  ip: string;
  userAgent?: string | undefined;
  userId?: string | undefined;
  traceId?: string | undefined;
}

export interface LogErrorLike {
  name: string;
  message: string;
  stack?: string | undefined;
  code?: unknown;
  cause?: unknown;
}

export interface LogEvent {
  time: string;
  level: Exclude<LogLevel, 'silent'>;
  msg: string;
  correlationId?: string | undefined;
  requestId?: string | undefined;
  method?: string | undefined;
  path?: string | undefined;
  meta?: LogMeta | undefined;
  err?: LogErrorLike | undefined;
  bindings?: LogMeta | undefined;
}

export interface Logger {
  trace(msgOrMeta: string | LogMeta, metaOrMsg?: LogMeta | string): void;
  debug(msgOrMeta: string | LogMeta, metaOrMsg?: LogMeta | string): void;
  info(msgOrMeta: string | LogMeta, metaOrMsg?: LogMeta | string): void;
  warn(msgOrMeta: string | LogMeta, metaOrMsg?: LogMeta | string): void;
  error(
    errOrMetaOrMsg: Error | LogMeta | string,
    msgOrMeta?: string | LogMeta,
    meta?: LogMeta,
  ): void;
  fatal(
    errOrMetaOrMsg: Error | LogMeta | string,
    msgOrMeta?: string | LogMeta,
    meta?: LogMeta,
  ): void;
  child(bindings: LogMeta): Logger;
  isLevelEnabled?(level: LogLevel): boolean;
}

export const LOG_LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 100,
} as const;

export const SENSITIVE_KEYS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'cookies',
  'set-cookie',
  'x-api-key',
  'x-csrf-token',
  'x-sudo-token',
  'rawHeaders',
  'rawTrailers',
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'csrfToken',
  'cookieToken',
  'requestToken',
  'sudoToken',
  'challengeToken',
  'verificationToken',
  'captchaToken',
  'totpCode',
  'backupCodes',
  'tokenHash',
  'codeHash',
  'secret',
  'clientSecret',
  'totpSecret',
  'jwtSecret',
  'previousSecret',
  'sealSecret',
  'signingSecret',
  'webhookSecret',
  'secretKey',
  'secretAccessKey',
  'key',
  'apiKey',
  'privateKey',
  'encryptionKey',
  'oauthTokenEncryptionKey',
  'restApiKey',
  'userAuthKey',
  'authToken',
  'creditCard',
  'cvv',
  'cardDetails',
] as const;
