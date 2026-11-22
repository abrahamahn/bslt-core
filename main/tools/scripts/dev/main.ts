#!/usr/bin/env tsx
// main/tools/scripts/dev/main.ts
/**
 * Development environment orchestrator.
 *
 * Runs all sync watchers silently in background, starts the server
 * runtime directly, and runs other dev tasks (web) via Turbo.
 *
 * Usage:
 *   pnpm dev              # Start server + web
 *   pnpm dev:all          # Start all available dev tasks
 *   pnpm dev server       # Start server only
 *   pnpm dev --with-postgres  # Start docker postgres sidecar in-process
 */
import { execSync, spawn } from 'child_process';
import { createServer, Socket } from 'node:net';
import process from 'node:process';

import { buildConnectionString, canReachDatabase } from '@bslt/db';
import { initEnv, loadConfig } from '@bslt/server-system/config';
import {
  createLineStreamHandler,
  createTurboLineProcessor,
  logLine,
  normalizeServerLine,
  renderSectionHeader,
  renderStartupBanner,
  shouldSuppressServerLine,
} from '@bslt/server-system/logger/dev';

import { REPO_ROOT as ROOT } from '../../lib/paths';

import { resolveDevAppName } from './appName';
import { migrationFailureLines } from './migration-failure';

import type { ChildProcess } from 'child_process';

interface DevCliOptions {
  filters: string[];
  withPostgres: boolean;
}

function parseCliArgs(argv: readonly string[]): DevCliOptions {
  const filters: string[] = [];
  let withPostgres = false;

  for (const arg of argv) {
    if (arg === '--with-postgres') {
      withPostgres = true;
      continue;
    }
    filters.push(arg);
  }

  return { filters, withPostgres };
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

/**
 * Probe whether a port is actually bindable on all interfaces (0.0.0.0, the host
 * the server binds). A bind+close is authoritative ("can I take this port?")
 * whereas a TCP connect only proves nothing is currently *listening* — and it is
 * instant, avoiding the per-port connect timeout.
 */
function isPortBindable(port: number, host = '0.0.0.0'): Promise<boolean> {
  return new Promise((resolveBindable) => {
    const server = createServer();
    server.once('error', () => resolveBindable(false));
    server.once('listening', () => server.close(() => resolveBindable(true)));
    server.listen(port, host);
  });
}

/**
 * Scan upward from `start` for the first free port. Lets bslt dev coexist with
 * other local apps (or a stale instance) instead of killing whatever holds the
 * default port.
 */
async function findFreePort(start: number, maxScan = 50): Promise<number> {
  for (let port = start; port < start + maxScan; port += 1) {
    if (await isPortBindable(port)) return port;
  }
  throw new Error(`No free port found in range ${start}-${start + maxScan - 1}`);
}

/**
 * Pre-pick free web + api ports and publish them via env so Vite (port + proxy
 * target) and the server (API_PORT) all agree on the same coordinates.
 */
async function resolveDevPorts(needsWeb: boolean, needsServer: boolean): Promise<void> {
  logLine('ports', 'Resolving free ports');

  if (needsServer) {
    const preferred = Number(process.env['API_PORT'] ?? process.env['PORT'] ?? 8080) || 8080;
    const apiPort = await findFreePort(preferred);
    process.env['API_PORT'] = String(apiPort);
    process.env['VITE_PROXY_TARGET'] = `http://127.0.0.1:${String(apiPort)}`;
    process.env['VITE_PROXY_WS_TARGET'] = `ws://127.0.0.1:${String(apiPort)}`;
    const suffix = apiPort === preferred ? '' : ` (default ${String(preferred)} busy)`;
    logLine('ports', `API port: ${String(apiPort)}${suffix}`, 'ok');
  }

  if (needsWeb) {
    // Honor a configured web port (VITE_DEV_PORT, else APP_PORT) loaded from .env;
    // fall back to the conventional 5173.
    const preferred =
      Number(process.env['VITE_DEV_PORT'] ?? process.env['APP_PORT'] ?? 5173) || 5173;
    const webPort = await findFreePort(preferred);
    publishWebPortEnv(webPort);
    const suffix = webPort === preferred ? '' : ` (default ${String(preferred)} busy)`;
    logLine('ports', `Web port: ${String(webPort)}${suffix}`, 'ok');
  }

  console.log('');
}

/**
 * Publish the chosen web port so every consumer agrees on it:
 * - VITE_DEV_PORT     → Vite dev server port
 * - APP_PORT          → server's appBaseUrl (OAuth/magic-link redirects target the real origin)
 * - CORS_ORIGINS      → server allows the chosen web origin (additive; never drops configured ones)
 * Without this, a web port shifted off 5173 (busy) would leave redirects and the
 * CORS allowlist pointing at the wrong origin.
 */
function publishWebPortEnv(webPort: number): void {
  process.env['VITE_DEV_PORT'] = String(webPort);
  process.env['APP_PORT'] = String(webPort);

  const webOrigins = [`http://localhost:${String(webPort)}`, `http://127.0.0.1:${String(webPort)}`];
  const existing = (process.env['CORS_ORIGINS'] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  process.env['CORS_ORIGINS'] = [...new Set([...existing, ...webOrigins])].join(',');
}

/**
 * Ensure the Docker daemon is running. On WSL2 with systemd disabled,
 * the daemon may not auto-start; attempt to bring it up before launching compose.
 */
function ensureDockerDaemon(): void {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return; // daemon is already up
  } catch {
    // daemon is not running — try to start it
  }

  logLine('docker', 'Docker daemon not running. Attempting to start...');

  const startCommands = ['sudo systemctl start docker', 'sudo service docker start'];

  for (const cmd of startCommands) {
    try {
      execSync(cmd, { stdio: 'ignore' });
      logLine('docker', 'Docker daemon started', 'ok');
      return;
    } catch {
      // try next
    }
  }

  logLine('docker', 'Could not start Docker daemon automatically', 'warn');
  logLine('docker', 'Run: sudo systemctl start docker', 'warn');
}

async function waitForPort(port: number, retries = 60, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    if (await isPortOpen(port)) return true;
    await sleep(delayMs);
  }
  return false;
}

async function ensurePostgres(withPostgres: boolean): Promise<void> {
  const rawPort = process.env['POSTGRES_PORT'] ?? '5432';
  const port = Number(rawPort);
  const targetPort = Number.isFinite(port) ? port : 5432;

  const isRunning = await isPortOpen(targetPort);

  if (isRunning) {
    logLine('db', `PostgreSQL is running on port ${String(targetPort)}`, 'ok');
    return;
  }

  if (withPostgres) {
    // Docker container is starting — poll the port until it opens (60s max)
    logLine('db', `Waiting for Docker PostgreSQL on port ${String(targetPort)}...`);
    const ready = await waitForPort(targetPort);
    if (ready) {
      logLine('db', `PostgreSQL is ready on port ${String(targetPort)}`, 'ok');
    } else {
      logLine('db', `Docker PostgreSQL did not become ready on port ${String(targetPort)}`, 'warn');
    }
    return;
  }

  if (targetPort !== 5432) {
    logLine('db', `PostgreSQL not running on port ${String(targetPort)}`, 'warn');
    return;
  }

  logLine('db', 'PostgreSQL not running. Attempting to start...');

  try {
    execSync('sudo service postgresql start', { stdio: 'inherit' });
    logLine('db', 'PostgreSQL started', 'ok');
  } catch {
    logLine('db', 'Could not start PostgreSQL automatically', 'warn');
    logLine('db', 'Start it manually: sudo service postgresql start', 'warn');
  }
}

async function runEnvPreflight(filters: string[]): Promise<void> {
  if (filters.length > 0 && !filters.includes('server')) return;

  process.env['NODE_ENV'] ??= 'development';

  logLine('env', 'Validating environment files');
  await loadConfig();
  logLine('env', 'Environment OK', 'ok');
}

function redactDbUrl(url: string): string {
  return url.replace(/:(?:[^:@/]+)@/g, ':****@');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDatabaseConnection(filters: string[]): Promise<void> {
  if (filters.length > 0 && !filters.includes('server')) return;

  const connectionString = buildConnectionString(process.env as Record<string, string | undefined>);
  const retriesRaw = process.env['DEV_DB_CONNECT_RETRIES'] ?? '30';
  const delayRaw = process.env['DEV_DB_CONNECT_RETRY_MS'] ?? '1000';
  const retries = Math.max(1, Number.parseInt(retriesRaw, 10) || 30);
  const retryDelayMs = Math.max(100, Number.parseInt(delayRaw, 10) || 1000);

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const ok = await canReachDatabase(connectionString);
    if (ok) {
      logLine('db', 'Database connection OK', 'ok');
      return;
    }

    if (attempt === 1 && retries > 1) {
      logLine('db', 'Waiting for database startup...', 'info');
    }

    if (attempt < retries) {
      await sleep(retryDelayMs);
    }
  }

  logLine('db', 'Database connection failed', 'error');
  process.stderr.write(`   ${redactDbUrl(connectionString)}\n`);
  process.stderr.write('\nFix options:\n');
  process.stderr.write('1) Use Docker Postgres: pnpm docker:dev\n');
  process.stderr.write('2) Use local Postgres: check config/env/.env.local\n');
  process.exit(1);
}

function startWatcher(target: 'headers' | 'theme'): ChildProcess {
  const watcher = spawn('pnpm', ['exec', 'bslt', 'sync', target, '--watch', '--quiet'], {
    cwd: ROOT,
    stdio: 'ignore',
    shell: false,
  });

  watcher.on('error', (err) => {
    logLine('watch', `bslt sync ${target} failed to start: ${String(err)}`, 'error');
  });

  return watcher;
}

function processOutput(line: string, isError = false, scope = 'server'): void {
  const text = line.replace(/\r$/, '');
  if (text.trim() === '') return;

  if (scope === 'server') {
    const normalizedServer = normalizeServerLine(text);
    if (normalizedServer.passthrough !== undefined) {
      const target = isError ? process.stderr : process.stdout;
      target.write(`${normalizedServer.passthrough}\n`);
      return;
    }
    if (
      normalizedServer.scope !== undefined &&
      normalizedServer.level !== undefined &&
      normalizedServer.message !== undefined
    ) {
      if (
        normalizedServer.scope === 'server' &&
        shouldSuppressServerLine(normalizedServer.message)
      ) {
        return;
      }
      logLine(
        normalizedServer.scope,
        normalizedServer.message,
        isError ? 'error' : normalizedServer.level,
        normalizedServer.time,
      );
      return;
    }
    logLine('server', text, isError ? 'error' : 'info');
  } else {
    logLine(scope, text, isError ? 'error' : 'info');
  }
}

function startServerRuntime(): ChildProcess {
  // Resolve workspace packages from their `source` export condition (TypeScript
  // sources) instead of built `dist` across static and dynamic imports alike.
  // Without it Node falls through to `default` → `dist`, which goes stale whenever
  // a package's source changes without a rebuild. Loading source keeps every
  // package fresh in dev and removes the boot race against the separate turbo build.
  const nodeOptions = [process.env['NODE_OPTIONS'], '--conditions=source']
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');

  // Directly run the server main entry point using tsx
  const server = spawn(
    'pnpm',
    ['tsx', '--tsconfig', 'main/apps/server/tsconfig.json', 'main/apps/server/src/main.ts'],
    {
      cwd: ROOT,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: false,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        NODE_OPTIONS: nodeOptions,
      },
    },
  );

  const stdoutLines = createLineStreamHandler((line) => processOutput(line, false, 'server'));
  const stderrLines = createLineStreamHandler((line) => processOutput(line, true, 'server'));

  server.stdout?.on('data', (data) => stdoutLines.push(data));
  server.stderr?.on('data', (data) => stderrLines.push(data));
  server.stdout?.on('end', () => stdoutLines.flush());
  server.stderr?.on('end', () => stderrLines.flush());

  server.on('error', (err) => {
    logLine('server', `Failed to start: ${String(err)}`, 'error');
  });

  return server;
}

function startPostgresCompose(): ChildProcess {
  const postgres = spawn('pnpm', ['tsx', 'main/tools/scripts/dev/postgres.ts'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      NODE_ENV: 'development',
    },
  });

  postgres.on('error', (err) => {
    logLine('postgres', `Failed to start: ${String(err)}`, 'error');
  });

  return postgres;
}

function startTurboDev(filters: string[]): ChildProcess {
  const args = ['turbo', 'run', 'dev', '--log-order=stream', '--log-prefix=task'];
  const devNodeMaxOldSpaceMb = process.env['DEV_NODE_MAX_OLD_SPACE_MB'] ?? '1024';
  const existingNodeOptions = process.env['NODE_OPTIONS']?.trim() ?? '';
  const nodeOptions = existingNodeOptions.includes('--max-old-space-size=')
    ? existingNodeOptions
    : `${existingNodeOptions} --max-old-space-size=${devNodeMaxOldSpaceMb}`.trim();

  // Exclude server from Turbo, as we run it directly
  const turboFilters = filters.length > 0 ? filters.filter((f) => f !== 'server') : [];

  if (filters.length === 0) {
    // If no filters provided, we want everything EXCEPT server via turbo
    args.push('--filter=!@bslt/server');
  } else {
    for (const f of turboFilters) {
      args.push(`--filter=@bslt/${f}`);
    }
    // If only server was requested, turbo doesn't need to run anything
    if (turboFilters.length === 0 && filters.includes('server')) {
      return { kill: () => {}, on: () => {} } as unknown as ChildProcess;
    }
  }

  const turbo = spawn('pnpm', args, {
    cwd: ROOT,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      TURBO_LOG: 'light',
      NODE_OPTIONS: nodeOptions,
    },
  });

  const turboLineProcessor = createTurboLineProcessor();

  const processTurboLine = (line: string, isError = false): void => {
    const normalizedLines = turboLineProcessor.push(line, isError);
    for (const normalized of normalizedLines) {
      logLine(normalized.scope, normalized.message, normalized.level);
    }
  };

  const stdoutLines = createLineStreamHandler((line) => processTurboLine(line, false));
  const stderrLines = createLineStreamHandler((line) => processTurboLine(line, true));

  turbo.stdout?.on('data', (data) => stdoutLines.push(data));
  turbo.stderr?.on('data', (data) => stderrLines.push(data));
  turbo.stdout?.on('end', () => stdoutLines.flush());
  turbo.stderr?.on('end', () => stderrLines.flush());
  turbo.on('close', () => {
    for (const normalized of turboLineProcessor.flush()) {
      logLine(normalized.scope, normalized.message, normalized.level);
    }
  });

  turbo.on('error', (err) => {
    logLine('turbo', `Failed to start: ${String(err)}`, 'error');
  });

  return turbo;
}

export async function main(argv: readonly string[] = []): Promise<void> {
  const options = parseCliArgs(argv);
  const { filters, withPostgres } = options;

  // Load .env files first so the startup banner shows the configured app name
  // and port resolution honors configured ports (API_PORT, APP_PORT) and can
  // extend the existing CORS_ORIGINS. initEnv only fills keys not already in
  // process.env, so the later loadConfig() call is idempotent.
  process.env['NODE_ENV'] ??= 'development';
  await initEnv();

  const mode =
    filters.length > 0
      ? `Mode: ${filters.map((f) => `@bslt/${f}`).join(' + ')}`
      : 'Mode: full workspace';
  // Show the configured app name (matching config.app.name), not 'Your App'.
  renderStartupBanner({ mode, title: resolveDevAppName() });

  const needsServer = filters.length === 0 || filters.includes('server');
  const needsWeb = filters.length === 0 || filters.includes('web');
  if (needsWeb || needsServer) await resolveDevPorts(needsWeb, needsServer);

  let postgres: ChildProcess | undefined;
  if (needsServer && withPostgres) {
    const configuredDatabase = buildConnectionString(
      process.env as Record<string, string | undefined>,
    );
    if (await canReachDatabase(configuredDatabase)) {
      logLine('postgres', 'Configured PostgreSQL is already reachable; reusing it', 'ok');
    } else {
      ensureDockerDaemon();
      logLine('postgres', 'Starting Docker PostgreSQL service');
      postgres = startPostgresCompose();

      // Register exit handler immediately so Docker failures are caught before the retry window
      postgres.on('exit', (code, signal) => {
        if (signal === 'SIGINT' || signal === 'SIGTERM') return;
        const exitCode = code ?? 0;
        if (exitCode !== 0) {
          logLine('postgres', `Exited with code ${String(exitCode)}`, 'error');
          process.exit(exitCode);
        }
      });
    }
  }

  renderSectionHeader('Development Environment', 'Preparing local services and watchers');

  await runEnvPreflight(filters);

  if (needsServer) {
    await ensurePostgres(withPostgres);
    await ensureDatabaseConnection(filters);

    logLine('db', 'Verifying database schema...');
    try {
      execSync('pnpm db:migrate', { stdio: 'pipe' });
      logLine('db', 'Database schema up to date', 'ok');
    } catch (error) {
      logLine('db', 'Migration failed (continuing; the server may not start)', 'warn');
      // The runner's own words: an edited baseline names `pnpm bslt db reset`.
      for (const line of migrationFailureLines(error)) logLine('db', line, 'warn');
    }
  }

  const watchers = [startWatcher('headers'), startWatcher('theme')];

  logLine('watch', 'Sync watchers running (headers, theme)', 'ok');

  setTimeout(() => {
    logLine('turbo', 'Starting Dev tasks');

    const turbo = startTurboDev(filters);
    let server: ChildProcess | undefined;
    let isShuttingDown = false;

    if (needsServer) {
      server = startServerRuntime();
    }

    const cleanup = (exitCode = 0): void => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      console.log('');
      logLine('dev', 'Shutting down...');
      for (const w of watchers) w.kill();
      turbo.kill();
      if (server && !server.killed) server.kill();
      if (postgres && !postgres.killed) postgres.kill();
      process.exit(exitCode);
    };

    process.on('SIGINT', () => cleanup(0));
    process.on('SIGTERM', () => cleanup(0));

    turbo.on('exit', (code) => {
      if (isShuttingDown) return;
      const exitCode = code ?? 0;
      if (exitCode !== 0) {
        logLine('turbo', `Exited with code ${String(exitCode)}`, 'error');
        cleanup(exitCode);
        return;
      }
      if (!needsServer) cleanup(0);
    });
  }, 500);
}
