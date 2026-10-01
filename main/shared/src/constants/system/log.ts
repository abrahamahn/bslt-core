// main/shared/src/constants/system/log.ts
/**
 * Logging / ANSI
 */
export const LOG_LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 100,
} as const;

export const CONSOLE_LOG_LEVELS: Record<string, number> = LOG_LEVELS;

export const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
} as const;
