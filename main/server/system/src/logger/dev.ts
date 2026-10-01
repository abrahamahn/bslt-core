// main/server/system/src/logger/dev.ts
/**
 * Dev-time log normalization and rendering utilities.
 *
 * This module centralizes formatting/parsing used by local orchestration
 * scripts (dev runner, turbo output, docker postgres output).
 */

import process from 'node:process';
import { stripVTControlCharacters } from 'node:util';

import { colorize, levelToColor, nowHHMMSS, padLevel } from './formatter';

export type DevLogLevel = 'info' | 'ok' | 'warn' | 'error';

export interface NormalizedServerLine {
  handled: boolean;
  scope?: string | undefined;
  level?: DevLogLevel | undefined;
  time?: string | undefined;
  message?: string | undefined;
  passthrough?: string | undefined;
}

export interface NormalizedDevLine {
  scope: string;
  level: DevLogLevel;
  message: string;
}

export interface DevStartupBannerOptions {
  mode: string;
  title?: string | undefined;
  subtitle?: string | undefined;
  hint?: string | undefined;
  startedAt?: Date | undefined;
  clearScreen?: boolean | undefined;
}

export interface LineStreamHandler {
  push(chunk: Buffer | string): void;
  flush(): void;
}

export interface TurboLineProcessor {
  push(line: string, isErrorStream?: boolean): NormalizedDevLine[];
  flush(): NormalizedDevLine[];
}

interface SuppressionRule {
  pattern: string | RegExp;
  envFlag?: string | undefined;
}

interface ViteProxyErrorBlock {
  scope: string;
  method?: string | undefined;
  path?: string | undefined;
  target?: string | undefined;
  error?: string | undefined;
}

const SERVER_NOISE_RULES: readonly SuppressionRule[] = [
  { pattern: 'Starting scheduled task', envFlag: 'DEV_LOG_VERBOSE_SCHEDULE' },
  { pattern: 'Scheduled task completed', envFlag: 'DEV_LOG_VERBOSE_SCHEDULE' },
];

const TURBO_SCOPED_NOISE_RULES: readonly RegExp[] = [
  /^>\s*@bslt\/[^@\s]+@\S+\s+dev\b/,
  /^cache bypass, force executing\b/,
];

const SECTION_DIVIDER = '------------------------------------------------------------------------';

function formatLevel(level: DevLogLevel): string {
  return level === 'ok' ? 'OK' : level.toUpperCase();
}

function stripAnsi(value: string): string {
  return stripVTControlCharacters(value);
}

function fromServerLevel(level: string): DevLogLevel {
  const normalized = level.toUpperCase();
  if (normalized === 'ERROR' || normalized === 'FATAL') return 'error';
  if (normalized === 'WARN') return 'warn';
  return 'info';
}

function fromPinoLevel(level: unknown): DevLogLevel {
  const n = typeof level === 'number' ? level : Number(level);
  if (Number.isNaN(n)) return 'info';
  if (n >= 50) return 'error';
  if (n >= 40) return 'warn';
  return 'info';
}

function inferTurboLevel(message: string, isErrorStream: boolean): DevLogLevel {
  const upper = stripAnsi(message).trimStart().toUpperCase();
  if (upper.startsWith('WARNING') || upper.startsWith('WARN')) return 'warn';
  if (upper.startsWith('ERROR')) return 'error';
  return isErrorStream ? 'error' : 'info';
}

function shouldSuppressTurboScopedLine(message: string): boolean {
  return TURBO_SCOPED_NOISE_RULES.some((pattern) => pattern.test(message));
}

function compactTurboScopedMessage(message: string): string {
  if (/^>\s+vite(?:\s|$)/.test(message)) return 'Starting Vite dev server';
  // Vite sometimes prefixes lines with local time, which duplicates left timestamp columns.
  return message.replace(/^\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)\s+/i, '');
}

function toTitleWords(value: string): string {
  const normalized = value.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  return normalized
    .split(' ')
    .filter((part) => part !== '')
    .map((part) => {
      if (part === 'infrastructuer') return 'Infrastructure';
      return `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`;
    })
    .join(' ');
}

function resolveCategory(parsed: Record<string, unknown>): string | null {
  const candidates = ['category', 'task', 'logger', 'name'];
  for (const key of candidates) {
    const raw = parsed[key];
    if (typeof raw === 'string' && raw.trim() !== '') return toTitleWords(raw);
  }
  return null;
}

function formatPinoCompact(message: string): NormalizedServerLine | null {
  if (!message.startsWith('{')) return null;

  try {
    const parsed = JSON.parse(message) as Record<string, unknown>;
    const msg = typeof parsed['msg'] === 'string' ? parsed['msg'] : '';
    const category = resolveCategory(parsed);
    const parts: string[] = [];

    if (category !== null) parts.push(`[${category}]`);
    parts.push(msg !== '' ? msg : 'Server event');

    for (const key of ['affectedCount', 'deleted', 'cleared', 'taskCount']) {
      const value = parsed[key];
      if (typeof value === 'number') parts.push(`(${key}=${String(value)})`);
    }

    return {
      handled: true,
      scope: 'server',
      level: fromPinoLevel(parsed['level']),
      message: parts.join(' '),
    };
  } catch {
    return null;
  }
}

function mapPostgresLevel(level: string): DevLogLevel {
  const normalized = level.toUpperCase();
  if (normalized === 'WARNING' || normalized === 'WARN') return 'warn';
  if (normalized === 'ERROR' || normalized === 'FATAL' || normalized === 'PANIC') return 'error';
  return 'info';
}

function centerLine(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const left = Math.floor((width - text.length) / 2);
  const right = width - text.length - left;
  return `${' '.repeat(left)}${text}${' '.repeat(right)}`;
}

function unwrapQuoted(value: string): string {
  const trimmed = value.trim().replace(/,\s*$/, '');
  const singleQuoted = trimmed.match(/^'(.*)'$/);
  if (singleQuoted?.[1] !== undefined) return singleQuoted[1];
  const doubleQuoted = trimmed.match(/^"(.*)"$/);
  if (doubleQuoted?.[1] !== undefined) return doubleQuoted[1];
  return trimmed;
}

function parseViteProxyField(
  message: string,
): { key: 'target' | 'error' | 'method' | 'path'; value: string } | null {
  const match = message.match(/^(target|error|method|path):\s*(.+)$/);
  if (!match || !match[1]) return null;
  const key = match[1] as 'target' | 'error' | 'method' | 'path';
  const value = unwrapQuoted(match[2] ?? '');
  return { key, value };
}

function getNetworkErrorCode(error: string | undefined): string | null {
  if (error === undefined || error.trim() === '') return null;
  const match = error.match(/\bE[A-Z0-9_]+\b/);
  return match?.[0] ?? null;
}

function formatViteProxySummary(block: ViteProxyErrorBlock): string {
  const method = block.method?.toUpperCase();
  const path = block.path;
  const target = block.target;
  const code = getNetworkErrorCode(block.error);

  const route = method && path ? `${method} ${path}` : path;
  if (code && route && target) return `[vite-proxy] upstream ${code} ${route} -> ${target}`;

  const detailParts = [
    block.error,
    route,
    target === undefined ? undefined : `-> ${target}`,
  ].filter((value): value is string => value !== undefined && value.trim() !== '');
  if (detailParts.length === 0) return '[vite-proxy] upstream error';
  return `[vite-proxy] upstream error ${detailParts.join(' ')}`;
}

function writeStdout(line: string): void {
  process.stdout.write(`${line}\n`);
}

export function logLine(
  scope: string,
  message: string,
  level: DevLogLevel = 'info',
  timeOverride?: string,
): void {
  const time = colorize(timeOverride ?? nowHHMMSS(), 'dim');
  const lvl = colorize(padLevel(formatLevel(level)), levelToColor(level));
  const scp = colorize(scope.padEnd(8, ' '), 'cyan');
  writeStdout(`${time} ${lvl} ${scp} ${message}`);
}

export function renderSectionHeader(title: string, subtitle?: string): void {
  writeStdout(colorize(SECTION_DIVIDER, 'dim'));
  logLine('dev', title, 'ok');
  if (subtitle) logLine('dev', subtitle);
  writeStdout(colorize(SECTION_DIVIDER, 'dim'));
}

export function renderStartupBanner(options: DevStartupBannerOptions): void {
  const title = options.title ?? 'Your App';
  const subtitle = options.subtitle ?? 'Development Environment';
  const hint = options.hint ?? 'Press Ctrl+C to stop all dev processes';
  const startedAt = options.startedAt ?? new Date();
  const clearScreen = options.clearScreen !== false;
  const started = `Started: ${startedAt.toLocaleString()}`;

  const content = [title, subtitle, '', options.mode, started, '', hint];
  const maxTextLength = content.reduce((max, line) => Math.max(max, line.length), 0);
  const innerWidth = maxTextLength + 4;
  const width = innerWidth + 4;

  const topBottom = colorize(`+${'-'.repeat(width - 2)}+`, 'cyan');
  const emptyLine = colorize(`| ${' '.repeat(innerWidth)} |`, 'dim');

  const contentLines = content.map((line) => {
    const centered = centerLine(line, innerWidth);
    const framed = `| ${centered} |`;
    if (line === title) return colorize(framed, 'green');
    if (line === subtitle) return colorize(framed, 'cyan');
    return colorize(framed, 'dim');
  });

  if (clearScreen) process.stdout.write('\x1b[2J\x1b[H');
  process.stdout.write(`${topBottom}\n`);
  for (const line of contentLines) process.stdout.write(`${line}\n`);
  process.stdout.write(`${emptyLine}\n`);
  process.stdout.write(`${topBottom}\n\n`);
}

export function normalizeServerLine(message: string): NormalizedServerLine {
  if (message.startsWith('[EnvLoader] ')) {
    return {
      handled: true,
      scope: 'env',
      level: 'info',
      message: message.slice('[EnvLoader] '.length),
    };
  }

  const compact = formatPinoCompact(message);
  if (compact !== null) return compact;

  // Keep structured/indented non-JSON lines in the formatted stream.
  if (message.startsWith('{') || message.startsWith('}') || message.startsWith('  ')) {
    return {
      handled: true,
      scope: 'server',
      level: 'info',
      message: colorize(`│ ${message}`, 'dim'),
    };
  }

  // Handle "server: [17:18:23] INFO message"
  const prefixMatch = message.match(
    /^server:\s+\[(\d{2}:\d{2}:\d{2})\]\s+(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)(?:\s+(.*))?$/,
  );
  if (prefixMatch && prefixMatch[1] && prefixMatch[2]) {
    const [, ts, lvl, tail] = prefixMatch;
    return {
      handled: true,
      scope: 'server',
      level: fromServerLevel(lvl),
      time: ts,
      message: tail !== undefined && tail.trim() === '|' ? '' : (tail ?? '').trim(),
    };
  }

  const bracketed = message.match(
    /^\[(\d{2}:\d{2}:\d{2})\]\s+(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+(.*)$/,
  );
  if (bracketed && bracketed[1] && bracketed[2] && bracketed[3]) {
    const [, ts, lvl, tail] = bracketed;
    return {
      handled: true,
      scope: 'server',
      level: fromServerLevel(lvl),
      time: ts,
      message: tail.trim() === '|' ? 'HTTP request log' : tail,
    };
  }

  // Handle "[2026-03-06T06:11:31.679Z] INFO Message"
  const isoBracketed = message.match(
    /^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]\s+(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+(.*)$/,
  );
  if (isoBracketed && isoBracketed[2] && isoBracketed[3]) {
    const [, , lvl, tail] = isoBracketed;
    return {
      handled: true,
      scope: 'server',
      level: fromServerLevel(lvl),
      message: tail.trim() === '|' ? 'HTTP request log' : tail,
    };
  }

  return {
    handled: true,
    scope: 'server',
    level: 'info',
    message,
  };
}

export function shouldSuppressServerLine(
  message: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return SERVER_NOISE_RULES.some((rule) => {
    if (rule.envFlag !== undefined && env[rule.envFlag] === '1') return false;
    if (typeof rule.pattern === 'string') return message === rule.pattern;
    return rule.pattern.test(message);
  });
}

export function isTurboSummaryLine(line: string): boolean {
  return line.startsWith('•') || line.startsWith('Tasks:') || line.startsWith('Cached:');
}

export function createLineStreamHandler(onLine: (line: string) => void): LineStreamHandler {
  let pending = '';
  return {
    push(chunk: Buffer | string): void {
      pending += chunk.toString();
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) onLine(line);
    },
    flush(): void {
      if (pending.trim() !== '') onLine(pending);
      pending = '';
    },
  };
}

export function normalizeTurboLine(line: string, isErrorStream = false): NormalizedDevLine | null {
  const cleanLine = stripAnsi(line.replace(/\r$/, ''));
  const normalized = cleanLine.trim();
  if (normalized === '') return null;

  const match = cleanLine.trimStart().match(/^@bslt\/([^:]+):dev:\s*(.*)$/);
  if (match && match[1]) {
    const scope = match[1];
    const scopedMessage = match[2] ?? '';
    if (scopedMessage.trim() === '' || shouldSuppressTurboScopedLine(scopedMessage)) return null;
    return {
      scope,
      level: inferTurboLevel(scopedMessage, isErrorStream),
      message: compactTurboScopedMessage(scopedMessage),
    };
  }

  if (isTurboSummaryLine(normalized)) {
    return {
      scope: 'turbo',
      level: 'info',
      message: normalized.replace(/@bslt\//g, ''),
    };
  }

  return {
    scope: 'turbo',
    level: inferTurboLevel(normalized, isErrorStream),
    message: cleanLine,
  };
}

export function createTurboLineProcessor(): TurboLineProcessor {
  const pendingViteProxyByScope = new Map<string, ViteProxyErrorBlock>();
  const suppressProxyErrorByScope = new Set<string>();
  const suppressStackByScope = new Set<string>();

  const emitPendingViteProxySummary = (scope: string): NormalizedDevLine | null => {
    const block = pendingViteProxyByScope.get(scope);
    if (!block) return null;
    pendingViteProxyByScope.delete(scope);
    return {
      scope,
      level: 'error',
      message: formatViteProxySummary(block),
    };
  };

  const processNormalized = (line: NormalizedDevLine): NormalizedDevLine[] => {
    const out: NormalizedDevLine[] = [];
    const scope = line.scope;
    const message = line.message;

    if (message === '[vite-proxy] upstream error {') {
      pendingViteProxyByScope.set(scope, { scope });
      return out;
    }

    const pendingBlock = pendingViteProxyByScope.get(scope);
    if (pendingBlock) {
      if (message === '}') {
        const summary = emitPendingViteProxySummary(scope);
        if (summary) out.push(summary);
        suppressProxyErrorByScope.add(scope);
        return out;
      }

      const field = parseViteProxyField(message);
      if (field) {
        pendingBlock[field.key] = field.value;
        return out;
      }

      const summary = emitPendingViteProxySummary(scope);
      if (summary) out.push(summary);
      suppressProxyErrorByScope.add(scope);
    }

    if (suppressProxyErrorByScope.has(scope) && /^\[vite\]\s+http proxy error:/.test(message)) {
      return out;
    }

    if (suppressProxyErrorByScope.has(scope) && /^Error:\s+connect\s+E[A-Z0-9_]+\b/.test(message)) {
      suppressProxyErrorByScope.delete(scope);
      suppressStackByScope.add(scope);
      return out;
    }

    if (suppressStackByScope.has(scope)) {
      if (/^\s*at\s+/.test(message)) return out;
      suppressStackByScope.delete(scope);
    }

    out.push(line);
    return out;
  };

  return {
    push(line: string, isErrorStream = false): NormalizedDevLine[] {
      const normalized = normalizeTurboLine(line, isErrorStream);
      if (normalized === null) return [];
      return processNormalized(normalized);
    },
    flush(): NormalizedDevLine[] {
      const out: NormalizedDevLine[] = [];
      for (const scope of pendingViteProxyByScope.keys()) {
        const summary = emitPendingViteProxySummary(scope);
        if (summary) out.push(summary);
      }
      suppressProxyErrorByScope.clear();
      suppressStackByScope.clear();
      return out;
    },
  };
}

export function normalizePostgresComposeLine(rawLine: string): NormalizedDevLine | null {
  const cleaned = stripAnsi(rawLine).replace(/\r$/, '').trim();
  if (cleaned === '') return null;

  if (/^Container\s+.+\s+(Running|Starting|Started|Stopping|Stopped)\s*$/.test(cleaned)) {
    return { scope: 'postgres', level: 'info', message: cleaned };
  }

  if (/^Attaching to\s+/.test(cleaned)) return null;

  if (/Gracefully Stopping/.test(cleaned)) {
    return { scope: 'postgres', level: 'warn', message: cleaned };
  }

  const withoutPrefix = cleaned.replace(/^[a-zA-Z0-9_.-]+\s+\|\s*/, '');
  if (withoutPrefix.trim() === '') return null;

  const pgStructured = withoutPrefix.match(
    /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+\w+\s+\[\d+\]\s+([A-Z]+):\s*(.*)$/,
  );
  if (pgStructured && pgStructured[1]) {
    const level = mapPostgresLevel(pgStructured[1]);
    const message = (pgStructured[2] ?? '').trim();
    return {
      scope: 'postgres',
      level,
      message: message === '' ? withoutPrefix : message,
    };
  }

  const pgLevelOnly = withoutPrefix.match(/^([A-Z]+):\s*(.*)$/);
  if (pgLevelOnly && pgLevelOnly[1]) {
    const level = mapPostgresLevel(pgLevelOnly[1]);
    const message = (pgLevelOnly[2] ?? '').trim();
    return {
      scope: 'postgres',
      level,
      message: message === '' ? withoutPrefix : message,
    };
  }

  return { scope: 'postgres', level: 'info', message: withoutPrefix };
}
