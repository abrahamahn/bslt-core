// main/server/system/src/logger/formatter.ts
/**
 * Shared logging formatting primitives for server and dev tools.
 */
import process from 'node:process';

export const USE_COLOR =
  typeof process !== 'undefined' && process.stdout.isTTY && process.env['NO_COLOR'] == null;

export const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
} as const;

export type ColorName = keyof typeof COLORS;

export function colorize(text: string, color: ColorName): string {
  if (!USE_COLOR) return text;
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

export function padLevel(level: string): string {
  return level.toUpperCase().padEnd(5);
}

export function nowHHMMSS(): string {
  return new Date().toISOString().slice(11, 19);
}

/**
 * Maps standard log levels to their corresponding UI colors.
 */
export function levelToColor(level: string): ColorName {
  const u = level.toUpperCase();
  if (u === 'ERROR' || u === 'FATAL') return 'red';
  if (u === 'WARN') return 'yellow';
  if (u === 'OK') return 'green';
  if (u === 'INFO') return 'blue';
  if (u === 'DEBUG') return 'cyan';
  if (u === 'TRACE') return 'gray';
  return 'gray';
}
