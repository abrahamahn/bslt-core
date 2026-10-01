// main/server/system/src/config/factory.ts
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_WEBHOOK_DELIVERY_TIMEOUT_MS, MAX_DELIVERY_ATTEMPTS } from '@bslt/shared/constants';
import { EnvSchema } from '@bslt/shared/system/config';

import { loadAuthConfig, validateAuthConfig } from './auth/auth';
import { loadCacheConfig } from './infra/cache';
import { loadDatabaseConfig, validateDatabaseConfig } from './infra/database';
import { loadPackageManagerConfig } from './infra/package';
import { loadQueueConfig } from './infra/queue';
import { loadServerConfig } from './infra/server';
import { loadStorageConfig, validateStorage } from './infra/storage';
import { loadBillingConfig, validateBillingConfig } from './services/billing';
import { loadEmailConfig, validateEmailConfig } from './services/email';
import { loadNotificationsConfig, validateNotificationsConfig } from './services/notifications';
import { loadSqlSearchConfig, validateSqlSearchConfig } from './services/search';

import type { AppConfig, FullEnv } from '@bslt/shared/system/config';

const DEFAULT_APP_NAME = 'Your App';

// ============================================================================
// 1. Low-Level Disk Reader (Consolidated from server-system)
// ============================================================================

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function parseAndPopulate(filePath: string): Promise<void> {
  if (!(await fileExists(filePath))) return;

  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;

      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;

      const key = trimmed.substring(0, idx).trim();
      let val = trimmed.substring(idx + 1).trim();

      const isQuoted =
        (val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"));
      if (!isQuoted) {
        // Support inline comments like: FLAG=false  # options: true | false
        val = val.replace(/\s+#.*$/, '').trim();
      }

      // Clean quotes
      if (isQuoted) val = val.slice(1, -1);

      // Priority: System Env > Custom File > Local > Stage
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch (err) {
    process.stderr.write(`[EnvLoader] Failed to read ${filePath}: ${String(err)}\n`);
  }
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Initializes the environment by loading .env files with correct priority.
 */
export async function initEnv(): Promise<void> {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  let currentDir = process.cwd();
  let configDir: string | null = null;

  // Locate config/env by searching upwards
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(currentDir, 'config');
    if (await isDirectory(candidate)) {
      configDir = candidate;
      break;
    }
    currentDir = path.dirname(currentDir);
  }

  if (configDir === null) {
    if (process.env['NODE_ENV'] !== 'test') {
      process.stdout.write(
        '[EnvLoader] Warning: config directory not found. Environment files skipped.\n',
      );
    }
    return;
  }

  const repoRoot = path.dirname(configDir);

  // Priority 1: Explicit ENV_FILE
  const customPath = process.env['ENV_FILE'];
  if (customPath !== undefined && customPath !== '') {
    const resolvedPath = path.resolve(process.cwd(), customPath);
    await parseAndPopulate(resolvedPath);
  }

  // Priority 2: .env.local (Config directory - Not committed)
  await parseAndPopulate(path.join(configDir, 'env', '.env.local'));

  // Priority 3: Stage-specific (.env.production, .env.development)
  const envFile = path.join(configDir, 'env', `.env.${nodeEnv}`);
  await parseAndPopulate(envFile);

  // Priority 4: Base .env (Config directory)
  await parseAndPopulate(path.join(configDir, 'env', '.env'));

  // Priority 5: Root fallbacks (for flexibility in deployment)
  await parseAndPopulate(path.join(repoRoot, '.env.local'));
  await parseAndPopulate(path.join(repoRoot, `.env.${nodeEnv}`));
  await parseAndPopulate(path.join(repoRoot, '.env'));
}

// ============================================================================
// 2. Config Factory
// ============================================================================

/**
 * The single source of truth for loading and validating the application configuration.
 *
 * **Responsibility**:
 * 1. Read raw environment variables (Record<string, string>).
 * 2. Validate them against the Zod schema (`EnvSchema`).
 * 3. Transform them into the structured `AppConfig` domain object.
 * 4. Apply domain-specific business rules (e.g., "SSL required in production").
 *
 * @param rawEnv - Raw environment variables (usually `process.env`).
 * @returns Validated `AppConfig` or exits process on error.
 */
export function load(rawEnv: Record<string, string | undefined> = process.env): AppConfig {
  // 1. Sanitize raw strings (trim inline comments)
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawEnv)) {
    if (typeof v === 'string') {
      sanitized[k] = v.replace(/\s+#.*$/, '').trim();
    } else {
      sanitized[k] = v;
    }
  }

  // 2. Validate raw strings against Zod Schema
  const envResult = EnvSchema.safeParse(sanitized);

  if (!envResult.success) {
    process.stderr.write('\n❌ bslt: Environment Validation Failed\n');
    process.stderr.write(`   ↳ ${envResult.error.message}\n`);
    process.exit(1);
  }

  // 3. Use the typed Zod output directly
  const env: FullEnv = envResult.data;

  const nodeEnv = env.NODE_ENV;
  const server = loadServerConfig(env);
  const appName = resolveAppName(env);

  const config: AppConfig = {
    app: {
      name: appName,
    },
    env: nodeEnv,
    server,
    database: loadDatabaseConfig(env),
    auth: loadAuthConfig(env, server.apiBaseUrl, appName),
    email: loadEmailConfig(env, appName),
    storage: loadStorageConfig(env, { apiBaseUrl: server.apiBaseUrl }),
    billing: loadBillingConfig(env, server.appBaseUrl, appName),
    cache: loadCacheConfig(env),
    queue: loadQueueConfig(env),
    notifications: loadNotificationsConfig(env),
    search: {
      provider: 'sql' as const,
      config: loadSqlSearchConfig(env),
    },
    packageManager: loadPackageManagerConfig(env),
    // ANALYTICS_SAMPLE_RATE is range-validated ([0, 1]) by AnalyticsEnvSchema.
    analytics: { sampleRate: env.ANALYTICS_SAMPLE_RATE ?? 1 },
    // DB_TENANCY_MODE is enum-validated by TenancyEnvSchema (default shared-rls).
    tenancy: { mode: env.DB_TENANCY_MODE },
    // Webhook keys are range-validated (or absent) by WebhookEnvSchema.
    webhooks: {
      deliveryTimeoutMs: env.WEBHOOK_DELIVERY_TIMEOUT_MS ?? DEFAULT_WEBHOOK_DELIVERY_TIMEOUT_MS,
      maxAttempts: env.WEBHOOK_MAX_ATTEMPTS ?? MAX_DELIVERY_ATTEMPTS,
      // Absent means false: reject private webhook targets unless a self-hosted
      // operator opts in. The metadata endpoint stays blocked either way.
      allowPrivateTargets: env.WEBHOOK_ALLOW_PRIVATE_TARGETS === 'true',
    },
  };

  validate(config);
  return config;
}

function resolveAppName(env: FullEnv): string {
  const configuredName = env.APP_NAME ?? env.VITE_APP_NAME ?? env.EMAIL_FROM_NAME;
  return typeof configuredName === 'string' && configuredName.trim().length > 0
    ? configuredName.trim()
    : DEFAULT_APP_NAME;
}

/**
 * Async variant that initializes environment files before loading config.
 * Use this at the process entry point. For tests, prefer `load(explicitEnv)`.
 *
 * @returns Validated `AppConfig` after reading `.env` files into `process.env`.
 */
export async function loadConfig(): Promise<AppConfig> {
  await initEnv();
  return load(process.env);
}

function validate(config: AppConfig): void {
  const errors: string[] = [];
  const isProd = config.env === 'production';

  // Auth Domain
  try {
    validateAuthConfig(config.auth);
  } catch (e) {
    if (e instanceof Error) {
      errors.push(e.message);
    } else {
      errors.push(String(e));
    }
  }

  // Billing Domain
  if (config.billing.enabled) {
    errors.push(...validateBillingConfig(config.billing, isProd));
  }

  // Email Domain
  errors.push(...validateEmailConfig(config.email, isProd));

  // Database Domain
  errors.push(...validateDatabaseConfig(config.database, isProd));

  // Search Domain
  errors.push(...validateSqlSearchConfig(config.search.config));

  // Notifications Domain
  errors.push(...validateNotificationsConfig(config.notifications));

  // Infrastructure: Storage
  errors.push(...validateStorage(config.storage, isProd));

  // HTTP Boundary Policy
  if (isProd) {
    if (config.server.apiBaseUrl.startsWith('http://')) {
      errors.push(
        `Server: API_URL must be an HTTPS URL in production (got: ${config.server.apiBaseUrl})`,
      );
    }
    if (!config.server.appBaseUrl.startsWith('https://')) {
      errors.push(
        `Server: APP_URL must be an HTTPS URL in production (got: ${config.server.appBaseUrl})`,
      );
    }
  }

  if (errors.length > 0) {
    const report = errors.map((e) => `  ↳ ❌ ${e}`).join('\n');
    const separator = '='.repeat(50);
    process.stderr.write(`\n${separator}\n`);
    process.stderr.write('  bslt CONFIGURATION ERROR\n');
    process.stderr.write(`${separator}\n`);
    process.stderr.write(`${report}\n`);
    process.stderr.write(`${separator}\n\n`);

    throw new Error(`Server failed to start: Invalid Configuration\n${errors.join('\n')}`);
  }
}
