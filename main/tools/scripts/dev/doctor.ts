// main/tools/scripts/dev/doctor.ts
/**
 * `pnpm bslt doctor`: single-command environment & configuration healthcheck
 * verifying toolchain versions, `bslt.config.ts`, `bslt.lock.json` integrity,
 * local/prod env secrets, OAuth callback consistency, and optional Postgres
 * TCP reachability.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import path from 'node:path';

import { REPO_ROOT } from '../../lib/paths';

type CheckStatus = 'pass' | 'warn' | 'fail';

interface DoctorCheck {
  readonly id: string;
  readonly label: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

interface DoctorReport {
  readonly ok: boolean;
  readonly checks: readonly DoctorCheck[];
}

interface DoctorOptions {
  readonly root?: string;
  readonly nodeVersion?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly checkTcp?: ((host: string, port: number) => Promise<boolean>) | undefined;
}

const MIN_NODE_MAJOR = 22;

const PLACEHOLDER_SECRET_PATTERNS = [
  'change-in-production',
  'dev-secret',
  'dev-cookie-secret',
  '0000000000000000',
] as const;

function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(filePath)) return out;
  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^['"]|['"]$/gu, '');
    out[key] = value;
  }
  return out;
}

function defaultCheckTcp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1500, () => {
      done(false);
    });
    socket.once('connect', () => {
      done(true);
    });
    socket.once('error', () => {
      done(false);
    });
  });
}

function resolveMigrationPath(root: string, key: string): string | null {
  const [owner, file] = key.split('/');
  if (owner === undefined || file === undefined) return null;
  if (owner === 'kernel') {
    return path.join(root, 'main/kernel/db/sql', file);
  }
  return path.join(root, 'main/modules', owner, 'server/migrations', file);
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function checkNodeVersion(version: string): DoctorCheck {
  const match = /^v?(\d+)/u.exec(version.trim());
  const major = match?.[1] !== undefined ? Number(match[1]) : 0;
  if (major >= MIN_NODE_MAJOR) {
    return {
      id: 'node-version',
      label: 'Node.js runtime',
      status: 'pass',
      detail: `${version} (>= v${String(MIN_NODE_MAJOR)} required)`,
    };
  }
  return {
    id: 'node-version',
    label: 'Node.js runtime',
    status: 'fail',
    detail: `Found ${version}; Node.js >= v${String(MIN_NODE_MAJOR)} is required.`,
  };
}

function checkConfigAndLockfile(root: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const configPath = path.join(root, 'bslt.config.ts');
  if (existsSync(configPath)) {
    const content = readFileSync(configPath, 'utf8');
    const valid = content.includes('defineConfig') && content.includes('installedModules');
    checks.push({
      id: 'bslt-config',
      label: 'Platform manifest (bslt.config.ts)',
      status: valid ? 'pass' : 'fail',
      detail: valid
        ? 'bslt.config.ts declares defineConfig + installedModules'
        : 'bslt.config.ts is missing defineConfig or installedModules',
    });
  } else {
    checks.push({
      id: 'bslt-config',
      label: 'Platform manifest (bslt.config.ts)',
      status: 'fail',
      detail: 'Missing bslt.config.ts in repository root',
    });
  }

  const lockPath = path.join(root, 'bslt.lock.json');
  if (!existsSync(lockPath)) {
    checks.push({
      id: 'lockfile-migrations',
      label: 'Migration checksum lock (bslt.lock.json)',
      status: 'fail',
      detail: 'Missing bslt.lock.json',
    });
    return checks;
  }

  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
      migrations?: Readonly<Record<string, string>>;
    };
    const entries = Object.entries(lock.migrations ?? {});
    const mismatches: string[] = [];
    for (const [key, expected] of entries) {
      const target = resolveMigrationPath(root, key);
      if (target === null || !existsSync(target)) {
        continue;
      }
      const actual = sha256Hex(readFileSync(target));
      if (actual !== expected) {
        mismatches.push(key);
      }
    }
    checks.push({
      id: 'lockfile-migrations',
      label: 'Migration checksum lock (bslt.lock.json)',
      status: mismatches.length === 0 ? 'pass' : 'fail',
      detail:
        mismatches.length === 0
          ? `Verified ${String(entries.length)} locked migration checksum(s)`
          : `Checksum drift detected in: ${mismatches.join(', ')}`,
    });
  } catch (error) {
    checks.push({
      id: 'lockfile-migrations',
      label: 'Migration checksum lock (bslt.lock.json)',
      status: 'fail',
      detail: `Failed to parse bslt.lock.json: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return checks;
}

function checkEnvAndSecrets(
  root: string,
  runtimeEnv: Readonly<Record<string, string | undefined>>,
): { readonly checks: DoctorCheck[]; readonly mergedEnv: Record<string, string> } {
  const localEnvPath = path.join(root, 'config/env/.env.local');
  const devEnvPath = path.join(root, 'config/env/.env.development');
  const fileEnv = {
    ...parseEnvFile(devEnvPath),
    ...parseEnvFile(localEnvPath),
  };
  const mergedEnv: Record<string, string> = { ...fileEnv };
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (value !== undefined) {
      mergedEnv[key] = value;
    }
  }

  const checks: DoctorCheck[] = [];
  const hasLocalEnv = existsSync(localEnvPath) || existsSync(devEnvPath);
  checks.push({
    id: 'env-files',
    label: 'Environment files',
    status: hasLocalEnv ? 'pass' : 'warn',
    detail: existsSync(localEnvPath)
      ? 'config/env/.env.local found'
      : existsSync(devEnvPath)
        ? 'config/env/.env.development found (run pnpm quickstart to generate .env.local)'
        : 'No local env file found under config/env/',
  });

  const isProd = mergedEnv['NODE_ENV'] === 'production';
  const jwtSecret = mergedEnv['JWT_SECRET'] ?? '';
  const cookieSecret = mergedEnv['COOKIE_SECRET'] ?? '';
  const hasWeakSecret = [jwtSecret, cookieSecret].some(
    (secret) =>
      secret.length < 32 ||
      PLACEHOLDER_SECRET_PATTERNS.some((pattern) => secret.toLowerCase().includes(pattern)),
  );
  checks.push({
    id: 'auth-secrets',
    label: 'Signing secrets (JWT_SECRET, COOKIE_SECRET)',
    status: hasWeakSecret ? (isProd ? 'fail' : 'warn') : 'pass',
    detail: hasWeakSecret
      ? isProd
        ? 'Production NODE_ENV detected with missing or placeholder JWT_SECRET/COOKIE_SECRET'
        : 'Using short or example dev secrets; run pnpm bslt init --force-env to generate 32-byte secrets'
      : '32+ byte non-placeholder JWT_SECRET and COOKIE_SECRET configured',
  });

  const oauthPairs: readonly {
    readonly name: string;
    readonly idKey: string;
    readonly secretKey: string;
  }[] = [
    { name: 'Google', idKey: 'GOOGLE_CLIENT_ID', secretKey: 'GOOGLE_CLIENT_SECRET' },
    { name: 'GitHub', idKey: 'GITHUB_CLIENT_ID', secretKey: 'GITHUB_CLIENT_SECRET' },
    { name: 'Apple', idKey: 'APPLE_CLIENT_ID', secretKey: 'APPLE_PRIVATE_KEY' },
  ];
  const brokenOAuth: string[] = [];
  for (const pair of oauthPairs) {
    const idVal = (mergedEnv[pair.idKey] ?? '').trim();
    const secretVal = (mergedEnv[pair.secretKey] ?? '').trim();
    if (idVal !== '' && secretVal === '') {
      brokenOAuth.push(`${pair.name} (${pair.idKey} set without ${pair.secretKey})`);
    }
  }
  checks.push({
    id: 'oauth-config',
    label: 'OAuth provider configuration',
    status: brokenOAuth.length === 0 ? 'pass' : 'fail',
    detail:
      brokenOAuth.length === 0
        ? 'Enabled OAuth providers have paired credentials'
        : `Incomplete OAuth config: ${brokenOAuth.join('; ')}`,
  });

  return { checks, mergedEnv };
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const root = options.root ?? REPO_ROOT;
  const runtimeEnv = options.env ?? process.env;
  const checkTcp = options.checkTcp ?? defaultCheckTcp;

  const checks: DoctorCheck[] = [
    checkNodeVersion(options.nodeVersion ?? process.version),
    ...checkConfigAndLockfile(root),
  ];

  const envCheck = checkEnvAndSecrets(root, runtimeEnv);
  checks.push(...envCheck.checks);

  const pgHost = envCheck.mergedEnv['POSTGRES_HOST'] ?? 'localhost';
  const pgPortRaw = Number(envCheck.mergedEnv['POSTGRES_PORT'] ?? '5432');
  const pgPort = Number.isInteger(pgPortRaw) && pgPortRaw > 0 ? pgPortRaw : 5432;
  const pgReachable = await checkTcp(pgHost, pgPort);
  checks.push({
    id: 'postgres-tcp',
    label: `PostgreSQL reachability (${pgHost}:${String(pgPort)})`,
    status: pgReachable ? 'pass' : 'warn',
    detail: pgReachable
      ? `TCP connection accepted on ${pgHost}:${String(pgPort)}`
      : `Could not reach ${pgHost}:${String(pgPort)} (start Docker Postgres with pnpm bslt postgres)`,
  });

  const ok = checks.every((check) => check.status !== 'fail');
  return { ok, checks };
}

export async function runDoctorCli(argv: readonly string[]): Promise<number> {
  const report = await runDoctor();
  if (argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  }

  console.log('\nBSLT Doctor Diagnostics\n');
  for (const check of report.checks) {
    const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '✗';
    console.log(`  ${icon} [${check.status.toUpperCase()}] ${check.label}`);
    console.log(`      ${check.detail}`);
  }
  console.log(
    report.ok ? '\n✅ All required checks passed.\n' : '\n❌ One or more required checks failed.\n',
  );
  return report.ok ? 0 : 1;
}
