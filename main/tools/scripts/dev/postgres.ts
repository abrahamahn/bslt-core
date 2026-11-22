#!/usr/bin/env tsx
// main/tools/scripts/dev/postgres.ts
/**
 * Postgres dev log adapter.
 *
 * Runs docker compose for postgres and normalizes container/database logs
 * into the same dev logger format used by other local processes.
 */

import { spawn } from 'child_process';
import process from 'node:process';

import {
  createLineStreamHandler,
  logLine,
  normalizePostgresComposeLine,
} from '@bslt/server-system/logger/dev';

import { REPO_ROOT as ROOT } from '../../lib/paths';

const composeArgs = [
  'compose',
  '--ansi',
  'never',
  '--env-file',
  'config/env/.env.local',
  '-f',
  'infra/docker/development/docker-compose.dev.yml',
  'up',
  'postgres',
];

export function main(): void {
  const child = spawn('docker', composeArgs, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: {
      ...process.env,
      COMPOSE_MENU: 'false',
    },
  });

  const stdoutLines = createLineStreamHandler((line) => {
    const parsed = normalizePostgresComposeLine(line);
    if (parsed === null) return;
    logLine(parsed.scope, parsed.message, parsed.level);
  });
  const stderrLines = createLineStreamHandler((line) => {
    const parsed = normalizePostgresComposeLine(line);
    if (parsed === null) return;
    logLine(parsed.scope, parsed.message, parsed.level);
  });

  child.stdout?.on('data', (chunk) => stdoutLines.push(chunk));
  child.stderr?.on('data', (chunk) => stderrLines.push(chunk));
  child.stdout?.on('end', () => stdoutLines.flush());
  child.stderr?.on('end', () => stderrLines.flush());

  child.on('error', (error) => {
    logLine('postgres', `Failed to start docker compose: ${String(error)}`, 'error');
    process.exit(1);
  });

  const forwardSignal = (signal: NodeJS.Signals): void => {
    if (!child.killed) child.kill(signal);
  };

  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));

  child.on('exit', (code, signal) => {
    if (signal === 'SIGINT' || signal === 'SIGTERM') {
      process.exit(0);
    }
    process.exit(code ?? 0);
  });
}
