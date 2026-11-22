// main/tools/scripts/dev/setup.ts
/**
 * Starter Interactive Setup Script
 *
 * Sets up a fresh clone of the repository with:
 * - Setup presets for different use cases
 * - Package manager selection and dependency installation
 * - Interactive environment file configuration
 * - Optional Docker database setup
 * - Database schema and seed data
 *
 * Presets:
 * - Quick Start: PostgreSQL starter defaults with local Docker services
 * - Docker Dev: PostgreSQL in Docker, console email
 * - Custom: Configure each service individually
 *
 * Usage: pnpm bootstrap
 */

import { spawnSync } from 'child_process';
import { randomFillSync } from 'crypto';
import { closeSync, existsSync, openSync, readFileSync, renameSync, writeSync } from 'fs';
import { Socket } from 'net';
import { dirname, relative, resolve } from 'path';
import { createInterface } from 'readline';

import { colorize as color } from '@bslt/server-system/logger/formatter';

import { REPO_ROOT as ROOT } from '../../lib/paths';

// =============================================================================
// Types
// =============================================================================

type SetupMode = 'development' | 'production';
type SetupPreset = 'quick' | 'docker' | 'custom';
type PackageManager = 'pnpm' | 'npm' | 'yarn';
type DatabaseProvider = 'postgresql';
type StorageProvider = 'local' | 's3';
type EmailProvider = 'console' | 'smtp';

interface SetupOptions {
  preset: SetupPreset;
  packageManager: PackageManager;
  skipInstall: boolean;
}

interface CliOptions {
  mode: SetupMode;
  preset?: SetupPreset;
  packageManager?: PackageManager;
  yes: boolean;
  force: boolean;
  skipInstall?: boolean;
  skipDocker: boolean;
  skipDb: boolean;
}

interface EnvConfig {
  // Database
  databaseProvider: DatabaseProvider;
  postgresHost: string;
  postgresPort: string;
  postgresUser: string;
  postgresPassword: string;
  postgresDb: string;
  databaseUseDocker: boolean;

  // App
  nodeEnv: string;
  appPort: string;
  apiPort: string;

  // Frontend
  viteApiUrl: string;
  viteAppName: string;

  // Security
  jwtSecret: string;
  cookieSecret: string;
  oauthTokenEncryptionKey: string;

  // Storage
  storageProvider: StorageProvider;
  storageLocalPath: string;
  storageLocalPublicUrl: string;

  // Email
  emailProvider: EmailProvider;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  emailFromName: string;
  emailFromAddress: string;

  // Production-only (empty/defaults for development; populated by the production gather)
  /** Cloud Postgres connection string; preferred by buildConnectionString when set. */
  databaseUrl: string;
  /** Production HTTPS API base + app URL (dev derives these from localhost ports). */
  apiBaseUrl: string;
  appUrl: string;
  /** Single CORS origin (production uses CORS_ORIGIN; development uses CORS_ORIGINS). */
  corsOrigin: string;
  /** Redis cache (production option; development always uses the in-memory cache). */
  cacheUseRedis: boolean;
  redisHost: string;
  redisPort: string;
}

// =============================================================================
// Constants
// =============================================================================

const ENV_DEV = resolve(ROOT, 'config/env/.env.development');
const ENV_PROD = resolve(ROOT, 'config/env/.env.production');
const DOCKER_COMPOSE = resolve(ROOT, 'infra/docker/development/docker-compose.dev.yml');

// Default configuration for Quick Start preset (runnable starter defaults)
const QUICK_START_ENV: EnvConfig = {
  databaseProvider: 'postgresql',
  postgresHost: 'localhost',
  postgresPort: '5432',
  postgresUser: 'postgres',
  postgresPassword: 'development',
  postgresDb: 'abe_dev',
  databaseUseDocker: true,
  nodeEnv: 'development',
  appPort: '5173',
  apiPort: '8080',
  viteApiUrl: 'http://localhost:8080',
  viteAppName: 'Abe',
  jwtSecret: '',
  cookieSecret: '',
  oauthTokenEncryptionKey: '',
  storageProvider: 'local',
  storageLocalPath: './uploads',
  storageLocalPublicUrl: 'http://localhost:8080/uploads',
  emailProvider: 'console',
  smtpHost: '',
  smtpPort: '587',
  smtpSecure: false,
  smtpUser: '',
  smtpPassword: '',
  emailFromName: 'Abe',
  emailFromAddress: 'no-reply@abe.com',
  databaseUrl: '',
  apiBaseUrl: '',
  appUrl: '',
  corsOrigin: '',
  cacheUseRedis: false,
  redisHost: '',
  redisPort: '6379',
};

// Default configuration for Docker Dev preset
const DOCKER_DEV_ENV: EnvConfig = {
  ...QUICK_START_ENV,
  databaseProvider: 'postgresql',
  postgresPassword: 'development',
};

// =============================================================================
// Utilities
// =============================================================================

function log(message: string): void {
  console.log(message);
}

function logStep(step: number, total: number, message: string): void {
  log(`\n${color(`[${String(step)}/${String(total)}]`, 'cyan')} ${color(message, 'bold')}`);
}

function logSuccess(message: string): void {
  log(`${color('✓', 'green')} ${message}`);
}

function logWarning(message: string): void {
  log(`${color('⚠', 'yellow')} ${message}`);
}

function logError(message: string): void {
  log(`${color('✗', 'red')} ${message}`);
}

function logInfo(message: string): void {
  log(`${color('ℹ', 'blue')} ${message}`);
}

// =============================================================================
// Interactive Prompts
// =============================================================================

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function promptWithDefault(question: string, defaultValue: string): Promise<string> {
  const hint = defaultValue ? color(` [${defaultValue}]`, 'dim') : '';
  const answer = await prompt(`${question}${hint}: `);
  return answer || defaultValue;
}

async function promptPassword(question: string, defaultValue: string): Promise<string> {
  const hint = defaultValue ? color(` [****]`, 'dim') : '';
  const answer = await prompt(`${question}${hint}: `);
  return answer || defaultValue;
}

async function promptChoice<T extends string>(
  question: string,
  choices: { key: string; label: string; value: T; description?: string }[],
  defaultKey?: string,
): Promise<T> {
  log('');
  log(color(question, 'bold'));
  for (const choice of choices) {
    const isDefault = choice.key === defaultKey;
    const prefix = isDefault ? color('→', 'green') : ' ';
    const suffix = isDefault ? color(' (recommended)', 'dim') : '';
    log(`  ${prefix} ${color(choice.key, 'cyan')}) ${choice.label}${suffix}`);
    if (choice.description) {
      log(`     ${color(choice.description, 'dim')}`);
    }
  }

  const defaultHint = defaultKey ? ` [${defaultKey}]` : '';
  const answer = await prompt(`\nYour choice${defaultHint}: `);

  const selected = answer || defaultKey;
  const choice = choices.find((c) => c.key === selected);

  if (!choice) {
    logWarning(`Invalid choice. Using default: ${defaultKey ?? '1'}`);
    const fallback = choices.find((c) => c.key === defaultKey) ?? choices[0];
    return fallback?.value as T;
  }

  return choice.value;
}

async function promptYesNo(question: string, defaultValue: boolean): Promise<boolean> {
  const hint = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = await prompt(`${question} ${hint}: `);

  if (!answer) return defaultValue;
  return answer.toLowerCase().startsWith('y');
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    mode: 'development',
    yes: false,
    force: false,
    skipDocker: false,
    skipDb: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case '--':
        break;
      case '--mode': {
        if (next !== 'development' && next !== 'production') {
          throw new Error('--mode must be one of: development, production');
        }
        options.mode = next;
        i++;
        break;
      }
      case '--production':
        options.mode = 'production';
        break;
      case '--development':
        options.mode = 'development';
        break;
      case '--preset': {
        if (next !== 'quick' && next !== 'docker' && next !== 'custom') {
          throw new Error('--preset must be one of: quick, docker, custom');
        }
        options.preset = next;
        i++;
        break;
      }
      case '--quick':
        options.preset = 'quick';
        break;
      case '--docker':
        options.preset = 'docker';
        break;
      case '--yes':
      case '-y':
        options.yes = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--skip-install':
        options.skipInstall = true;
        break;
      case '--install':
        options.skipInstall = false;
        break;
      case '--skip-docker':
        options.skipDocker = true;
        break;
      case '--skip-db':
        options.skipDb = true;
        break;
      case '--package-manager': {
        if (next !== 'pnpm' && next !== 'npm' && next !== 'yarn') {
          throw new Error('--package-manager must be one of: pnpm, npm, yarn');
        }
        options.packageManager = next;
        i++;
        break;
      }
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown setup option: ${arg}`);
    }
  }

  if (options.preset === 'custom' && options.yes) {
    throw new Error('--preset custom cannot be used with --yes');
  }

  return options;
}

function printUsage(): void {
  log(`Usage: pnpm bootstrap [-- --preset docker --yes]

Options:
  --preset <quick|docker|custom>  Select a setup preset.
  --quick                        Alias for --preset quick with PostgreSQL starter defaults.
  --docker                       Alias for --preset docker.
  --yes, -y                      Use defaults and skip confirmation prompts.
  --force                        Overwrite config/env/.env.development if it exists.
  --skip-install                 Do not install dependencies.
  --install                      Install dependencies even if node_modules exists.
  --skip-docker                  Do not start Docker services.
  --skip-db                      Do not push or seed the database.
  --package-manager <pnpm|npm|yarn>
  --help, -h`);
}

// =============================================================================
// Command Execution
// =============================================================================

function run(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; silent?: boolean },
): boolean {
  const { cwd, env, silent } = options ?? {};

  if (!silent) {
    log(color(`> ${command} ${args.join(' ')}`, 'dim'));
  }

  const result = spawnSync(command, args, {
    stdio: silent ? 'pipe' : 'inherit',
    cwd: cwd ?? ROOT,
    env: { ...process.env, ...env },
  });

  return result.status === 0;
}

function commandExists(command: string): boolean {
  const result = spawnSync(command, ['--version'], { stdio: 'pipe' });
  return result.status === 0;
}

/** True when something is already accepting TCP connections on the port. */
function isPortInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = new Socket();
    const finish = (inUse: boolean): void => {
      socket.destroy();
      resolveProbe(inUse);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => {
      finish(true);
    });
    socket.once('timeout', () => {
      finish(false);
    });
    socket.once('error', () => {
      finish(false);
    });
    socket.connect(port, host);
  });
}

/**
 * Resolve the running container id for a compose service — rename-proof, unlike
 * a hardcoded container name (the project/container name follows the slug).
 * Returns null if the service has no container yet.
 */
function composeContainerId(service: string): string | null {
  const result = spawnSync(
    'docker',
    ['compose', '-f', DOCKER_COMPOSE, '--env-file', ENV_DEV, 'ps', '-q', service],
    { stdio: 'pipe' },
  );
  if (result.status !== 0) return null;
  const id = result.stdout.toString().trim().split('\n')[0]?.trim();
  return id !== undefined && id !== '' ? id : null;
}

// =============================================================================
// Setup Steps
// =============================================================================

function printBanner(): void {
  log('');
  log(color('╔════════════════════════════════════════════════════════════════╗', 'cyan'));
  log(
    color('║', 'cyan') +
      color('                   STARTER SETUP                               ', 'bold') +
      color('║', 'cyan'),
  );
  log(
    color('║', 'cyan') +
      color('         Interactive Development Environment Setup             ', 'dim') +
      color('║', 'cyan'),
  );
  log(color('╚════════════════════════════════════════════════════════════════╝', 'cyan'));
  log('');
}

async function selectPreset(cli: CliOptions): Promise<SetupPreset> {
  if (cli.preset !== undefined) return cli.preset;

  log('Choose a setup preset to get started quickly, or customize everything.');
  log('');

  return promptChoice<SetupPreset>(
    'Select setup preset:',
    [
      {
        key: '1',
        label: 'Quick Start',
        value: 'quick',
        description: 'PostgreSQL starter defaults, console email, local file storage',
      },
      {
        key: '2',
        label: 'Docker Development',
        value: 'docker',
        description: 'PostgreSQL in Docker, console email - recommended for the SaaS starter',
      },
      {
        key: '3',
        label: 'Custom Setup',
        value: 'custom',
        description: 'Configure each service individually',
      },
    ],
    '2',
  );
}

async function gatherOptions(preset: SetupPreset, cli: CliOptions): Promise<SetupOptions> {
  // Check if dependencies are already installed
  const nodeModulesExists = existsSync(resolve(ROOT, 'node_modules'));
  let skipInstall = cli.skipInstall ?? false;

  if (cli.skipInstall === undefined && nodeModulesExists) {
    if (cli.yes) {
      skipInstall = true;
    } else {
      skipInstall = await promptYesNo('Dependencies already installed. Skip install step?', true);
    }
  }

  // Package manager selection
  const packageManager =
    cli.packageManager ??
    (cli.yes
      ? 'pnpm'
      : await promptChoice<PackageManager>(
          'Which package manager would you like to use?',
          [
            { key: '1', label: 'pnpm (fast, efficient)', value: 'pnpm' },
            { key: '2', label: 'npm (default Node.js)', value: 'npm' },
            { key: '3', label: 'yarn (classic)', value: 'yarn' },
          ],
          '1',
        ));

  // Check if selected package manager exists
  if (!commandExists(packageManager)) {
    logError(`${packageManager} is not installed.`);
    if (packageManager === 'pnpm') {
      logInfo('Install pnpm with: npm install -g pnpm');
    }
    process.exit(1);
  }

  return {
    preset,
    packageManager,
    skipInstall,
  };
}

function getPresetConfig(preset: SetupPreset): EnvConfig {
  const config = preset === 'quick' ? { ...QUICK_START_ENV } : { ...DOCKER_DEV_ENV };

  // Generate secrets
  config.jwtSecret = generateRandomSecret();
  config.cookieSecret = generateRandomSecret();
  config.oauthTokenEncryptionKey = generateRandomSecret();

  return config;
}

/** Prompt until the answer is non-empty and passes the validator. */
async function promptUntilValid(
  question: string,
  validate: (value: string) => string | null,
  defaultValue?: string,
): Promise<string> {
  for (;;) {
    const answer =
      defaultValue !== undefined && defaultValue !== ''
        ? await promptWithDefault(question, defaultValue)
        : (await prompt(`${question}: `)).trim();
    const error = validate(answer);
    if (error === null) return answer;
    logError(error);
  }
}

function isHttpsUrl(value: string): boolean {
  return /^https:\/\/.+/u.test(value);
}

function isPostgresUrl(value: string): boolean {
  return /^postgres(ql)?:\/\/.+/u.test(value);
}

/**
 * Full interactive gather for a production deployment: a cloud Postgres URL,
 * HTTPS app/API URLs, real SMTP, a single CORS origin, optional Redis, and
 * freshly generated strong secrets. No Docker — production targets a managed DB.
 */
async function gatherProductionEnvConfig(): Promise<EnvConfig> {
  const config: EnvConfig = { ...QUICK_START_ENV };
  config.nodeEnv = 'production';
  config.databaseUseDocker = false;

  log('');
  log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'dim'));
  log(color('                 PRODUCTION CONFIGURATION', 'bold'));
  log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'dim'));
  logInfo(
    'Targets a cloud database and writes config/env/.env.production. No local Docker is started.',
  );

  // Cloud database
  config.databaseUrl = await promptUntilValid('Cloud DATABASE_URL (postgresql://...)', (value) =>
    isPostgresUrl(value) ? null : 'Enter a postgresql:// or postgres:// connection string.',
  );

  // URLs (production validation requires HTTPS)
  config.appUrl = await promptUntilValid('App URL (https://...)', (value) =>
    isHttpsUrl(value) ? null : 'Must be an https:// URL.',
  );
  config.apiBaseUrl = await promptUntilValid(
    'API base URL (https://...)',
    (value) => (isHttpsUrl(value) ? null : 'Must be an https:// URL.'),
    config.appUrl,
  );
  config.corsOrigin = await promptUntilValid(
    'CORS origin (https://...)',
    (value) => (isHttpsUrl(value) ? null : 'Must be an https:// URL.'),
    config.appUrl,
  );
  config.viteApiUrl = config.apiBaseUrl;
  config.storageLocalPublicUrl = `${config.appUrl}/uploads`;

  // SMTP (production forbids the console email provider)
  log('');
  log(color('SMTP (required in production — console email is rejected)', 'bold'));
  config.emailProvider = 'smtp';
  config.smtpHost = await promptUntilValid('SMTP host', (value) =>
    value.length > 0 ? null : 'SMTP host is required.',
  );
  config.smtpPort = await promptWithDefault('SMTP port', config.smtpPort);
  config.smtpSecure = await promptYesNo('SMTP secure (TLS)?', true);
  config.smtpUser = await promptWithDefault('SMTP user', config.smtpUser);
  config.smtpPassword = await promptPassword('SMTP password', config.smtpPassword);
  config.emailFromName = await promptWithDefault('Email from name', config.emailFromName);
  config.emailFromAddress = await promptWithDefault('Email from address', config.emailFromAddress);

  // Optional Redis cache
  config.cacheUseRedis = await promptYesNo('Use Redis for cache?', false);
  if (config.cacheUseRedis) {
    config.redisHost = await promptWithDefault('Redis host', 'redis');
    config.redisPort = await promptWithDefault('Redis port', config.redisPort);
  }

  // Strong secrets
  config.jwtSecret = generateRandomSecret();
  config.cookieSecret = generateRandomSecret();
  config.oauthTokenEncryptionKey = generateRandomSecret();

  return config;
}

async function gatherCustomEnvConfig(): Promise<EnvConfig> {
  const config = { ...DOCKER_DEV_ENV };

  // Database provider selection
  log('');
  log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'dim'));
  log(color('                    DATABASE CONFIGURATION', 'bold'));
  log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'dim'));

  config.databaseProvider = await promptChoice<DatabaseProvider>(
    'Database provider:',
    [
      {
        key: '1',
        label: 'PostgreSQL',
        value: 'postgresql',
        description: 'Production-ready relational database',
      },
    ],
    '1',
  );

  config.databaseUseDocker = commandExists('docker')
    ? await promptYesNo('Use Docker for PostgreSQL?', true)
    : false;

  if (!config.databaseUseDocker) {
    config.postgresHost = await promptWithDefault('PostgreSQL host', config.postgresHost);
    config.postgresPort = await promptWithDefault('PostgreSQL port', config.postgresPort);
    config.postgresUser = await promptWithDefault('PostgreSQL user', config.postgresUser);
    config.postgresPassword = await promptPassword('PostgreSQL password', config.postgresPassword);
    config.postgresDb = await promptWithDefault('PostgreSQL database name', config.postgresDb);
  }

  // Application ports
  log('');
  log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'dim'));
  log(color('                    APPLICATION PORTS', 'bold'));
  log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'dim'));

  config.apiPort = await promptWithDefault('API server port', config.apiPort);
  config.viteApiUrl = `http://localhost:${config.apiPort}`;

  // Email provider
  log('');
  log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'dim'));
  log(color('                    EMAIL CONFIGURATION', 'bold'));
  log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'dim'));

  config.emailProvider = await promptChoice<EmailProvider>(
    'Email provider:',
    [
      {
        key: '1',
        label: 'Console (Mock)',
        value: 'console',
        description: 'Logs emails to console - perfect for development',
      },
      {
        key: '2',
        label: 'SMTP',
        value: 'smtp',
        description: 'Send real emails via SMTP server',
      },
    ],
    '1',
  );

  if (config.emailProvider === 'smtp') {
    config.smtpHost = await promptWithDefault('SMTP host', config.smtpHost);
    config.smtpPort = await promptWithDefault('SMTP port', config.smtpPort);
    config.smtpSecure = await promptYesNo('Use TLS/SSL?', config.smtpPort === '465');
    config.smtpUser = await promptWithDefault('SMTP username', config.smtpUser);
    config.smtpPassword = await promptPassword('SMTP password', config.smtpPassword);
    config.emailFromAddress = await promptWithDefault(
      'From email address',
      config.emailFromAddress,
    );
  }

  // Storage
  log('');
  log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'dim'));
  log(color('                    FILE STORAGE', 'bold'));
  log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'dim'));

  config.storageProvider = await promptChoice<StorageProvider>(
    'File storage provider:',
    [
      { key: '1', label: 'Local filesystem', value: 'local' },
      { key: '2', label: 'Amazon S3 / S3-compatible', value: 's3' },
    ],
    '1',
  );

  if (config.storageProvider === 'local') {
    config.storageLocalPath = await promptWithDefault(
      'Local storage path',
      config.storageLocalPath,
    );
    config.storageLocalPublicUrl = `http://localhost:${config.apiPort}/uploads`;
  }

  // Security secrets
  log('');
  log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'dim'));
  log(color('                    SECURITY SECRETS', 'bold'));
  log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'dim'));

  const generateSecrets = await promptYesNo('Generate secure random secrets automatically?', true);

  if (generateSecrets) {
    config.jwtSecret = generateRandomSecret();
    config.cookieSecret = generateRandomSecret();
    config.oauthTokenEncryptionKey = generateRandomSecret();
    logSuccess('Generated secure random secrets');
  } else {
    logInfo('Enter your own secrets (minimum 32 characters recommended)');
    config.jwtSecret = await promptWithDefault('JWT secret', generateRandomSecret());
    config.cookieSecret = await promptWithDefault('Cookie secret', generateRandomSecret());
    config.oauthTokenEncryptionKey = await promptWithDefault(
      'OAuth token encryption key',
      generateRandomSecret(),
    );
  }

  return config;
}

function generateEnvFileContent(config: EnvConfig): string {
  // Production diverges from development in a handful of values. Compute them
  // here so the single template below stays one source of truth; for development
  // every derived value equals the original literal (output is byte-identical).
  const isProd = config.nodeEnv === 'production';
  const apiBaseUrl = isProd ? config.apiBaseUrl : `http://localhost:${config.apiPort}`;
  const appUrl = isProd ? config.appUrl : `http://localhost:${config.appPort}`;
  const corsBlock = isProd
    ? `CORS_ORIGIN=${config.corsOrigin}`
    : `CORS_ORIGINS=http://localhost:${config.appPort},http://127.0.0.1:${config.appPort}`;
  const cacheProvider = config.cacheUseRedis ? 'redis' : 'local';
  const redisSection = config.cacheUseRedis
    ? `\nREDIS_HOST=${config.redisHost}\nREDIS_PORT=${config.redisPort}`
    : '';

  const dbSection = `# =============================================================================
# DATABASE (PostgreSQL)
# =============================================================================
DATABASE_PROVIDER=postgresql
DATABASE_URL=${config.databaseUrl}
POSTGRES_HOST=${config.postgresHost}
POSTGRES_PORT=${config.postgresPort}
POSTGRES_USER=${config.postgresUser}
POSTGRES_PASSWORD=${config.postgresPassword}
POSTGRES_DB=${config.postgresDb}
DB_MAX_CONNECTIONS=20
DB_SSL=${isProd ? 'true' : 'false'}

# Connection pool settings (optional)
# DB_MAX_CONNECTIONS=10
# DB_IDLE_TIMEOUT=30000
# DB_CONNECT_TIMEOUT=10000`;

  const emailSection =
    config.emailProvider === 'smtp'
      ? `# =============================================================================
# EMAIL (SMTP)
# =============================================================================
EMAIL_PROVIDER=smtp
SMTP_HOST=${config.smtpHost}
SMTP_PORT=${config.smtpPort}
SMTP_SECURE=${String(config.smtpSecure)}
SMTP_USER=${config.smtpUser}
SMTP_PASS=${config.smtpPassword}
EMAIL_FROM_NAME=${config.emailFromName}
EMAIL_FROM_ADDRESS=${config.emailFromAddress}`
      : `# =============================================================================
# EMAIL (Console Mock)
# =============================================================================
EMAIL_PROVIDER=console

# Note: Emails will be logged to console. Configure SMTP for production.
# EMAIL_PROVIDER=smtp
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASS=
# EMAIL_FROM_ADDRESS=noreply@example.com`;

  return `# =============================================================================
# Starter - ${isProd ? 'Production' : 'Development'} Environment Configuration
# Generated by setup script on ${new Date().toISOString()}
# =============================================================================

${dbSection}

# =============================================================================
# APPLICATION
# =============================================================================
NODE_ENV=${config.nodeEnv}
APP_NAME=${config.viteAppName}
HOST=0.0.0.0
PORT=${config.apiPort}
APP_PORT=${config.appPort}
API_PORT=${config.apiPort}
API_BASE_URL=${apiBaseUrl}
APP_URL=${appUrl}
LOG_LEVEL=info
LOG_CLIENT_ERROR_LEVEL=warn
LOG_REQUEST_CONTEXT=true
LOG_PRETTY_JSON=false
MAINTENANCE_MODE=false
AUDIT_RETENTION_DAYS=90

# =============================================================================
# FRONTEND (Vite)
# =============================================================================
VITE_API_URL=${config.viteApiUrl}
VITE_APP_NAME=${config.viteAppName}

# =============================================================================
# SECURITY & AUTH
# =============================================================================
JWT_SECRET=${config.jwtSecret}
COOKIE_SECRET=${config.cookieSecret}
OAUTH_TOKEN_ENCRYPTION_KEY=${config.oauthTokenEncryptionKey}
AUTH_STRATEGIES=local

# Access token expiry (default: 15m)
ACCESS_TOKEN_EXPIRY=15m
JWT_ISSUER=abe
JWT_AUDIENCE=abe-api

# Refresh token expiry in days (default: 7)
REFRESH_TOKEN_EXPIRY_DAYS=7
REFRESH_TOKEN_GRACE_PERIOD=30

# Account lockout settings
PASSWORD_MIN_LENGTH=8
PASSWORD_MAX_LENGTH=24
PASSWORD_MIN_SCORE=3
LOCKOUT_MAX_ATTEMPTS=10
LOCKOUT_DURATION_MS=1800000
MAGIC_LINK_EXPIRY_MINUTES=15
MAGIC_LINK_MAX_ATTEMPTS=3
TOTP_ISSUER=${config.viteAppName}
TOTP_WINDOW=1
CAPTCHA_ENABLED=false

# =============================================================================
# CORS / PROXY
# =============================================================================
${corsBlock}
TRUST_PROXY=true
TRUSTED_PROXIES=172.16.0.0/12,10.0.0.0/8
MAX_PROXY_DEPTH=1

# =============================================================================
# RATE LIMITING
# =============================================================================
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100

${emailSection}

# =============================================================================
# STORAGE
# =============================================================================
STORAGE_PROVIDER=${config.storageProvider}

# Local storage settings
STORAGE_ROOT_PATH=${config.storageLocalPath}
STORAGE_PUBLIC_BASE_URL=${config.storageLocalPublicUrl}

# S3 storage settings (uncomment if using S3)
# S3_BUCKET=my-bucket
# S3_REGION=us-east-1
# S3_ACCESS_KEY_ID=
# S3_SECRET_ACCESS_KEY=
# S3_ENDPOINT=
# S3_FORCE_PATH_STYLE=false
# S3_PRESIGN_EXPIRES_IN_SECONDS=3600

# =============================================================================
# CACHE / QUEUE / SEARCH
# =============================================================================
CACHE_PROVIDER=${cacheProvider}
CACHE_USE_REDIS=${String(config.cacheUseRedis)}
CACHE_TTL_MS=300000
CACHE_MAX_SIZE=1000${redisSection}
QUEUE_PROVIDER=local
QUEUE_POLL_INTERVAL_MS=1000
QUEUE_CONCURRENCY=5
QUEUE_MAX_ATTEMPTS=3
QUEUE_BACKOFF_BASE_MS=1000
QUEUE_MAX_BACKOFF_MS=300000
SEARCH_PROVIDER=sql
SQL_SEARCH_DEFAULT_PAGE_SIZE=50
SQL_SEARCH_MAX_PAGE_SIZE=1000
SQL_SEARCH_MAX_QUERY_DEPTH=5
SQL_SEARCH_MAX_CONDITIONS=20
SQL_SEARCH_LOGGING=false
SQL_SEARCH_TIMEOUT_MS=5000

# =============================================================================
# EXTERNAL SERVICES (Optional)
# =============================================================================
# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=
BILLING_CURRENCY=usd
BILLING_PORTAL_RETURN_URL=${appUrl}/settings/billing
BILLING_CHECKOUT_SUCCESS_URL=${appUrl}/billing/success
BILLING_CHECKOUT_CANCEL_URL=${appUrl}/billing/cancel
PLAN_FREE_ID=plan_free
PLAN_PRO_ID=plan_pro
PLAN_ENTERPRISE_ID=plan_enterprise

# =============================================================================
# PACKAGE MANAGER
# =============================================================================
PACKAGE_MANAGER_PROVIDER=pnpm
NPM_AUDIT=true
NPM_LEGACY_PEER_DEPS=false
NPM_REGISTRY=https://registry.npmjs.org/
PNPM_STRICT_PEER_DEPS=true
PNPM_FROZEN_LOCKFILE=true
PNPM_REGISTRY=https://registry.npmjs.org/
YARN_AUDIT=true
YARN_FROZEN_LOCKFILE=true
YARN_REGISTRY=https://registry.npmjs.org/

# =============================================================================
# DEVELOPMENT TOOLS
# =============================================================================
# DEBUG=true
# DRIZZLE_STUDIO_PORT=4983
`;
}

function generateRandomSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint8Array(48);
  randomFillSync(randomValues);
  for (const byte of randomValues) {
    const char = chars[byte % chars.length];
    if (char !== undefined) {
      result += char;
    }
  }
  return result;
}

function parseEnvFile(path: string): Record<string, string> {
  try {
    const content = readFileSync(path, 'utf-8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const match = line.match(/^([^=:#]+?)[=:](.*)/);
      if (match) {
        const key = match[1]?.trim();
        const value = match[2]?.trim().replace(/^['"](.*)['"]$/, '$1') ?? '';
        if (key) env[key] = value;
      }
    }
    return env;
  } catch {
    return {};
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeFileAtomic(targetPath: string, content: string): void {
  const directory = dirname(targetPath);
  const suffixBytes = new Uint8Array(4);
  randomFillSync(suffixBytes);
  const suffixHex = Buffer.from(suffixBytes).toString('hex');
  const tempPath = resolve(directory, `.tmp-${process.pid}-${suffixHex}.env`);
  // Use openSync with mode to set permissions atomically (no brief window with default perms)
  const fd = openSync(tempPath, 'wx', 0o600);
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
  renameSync(tempPath, targetPath);
}

// =============================================================================
// Installation Steps
// =============================================================================

function getStepCount(mode: SetupMode): number {
  // Development: install, env, docker, schema push, seed, finish.
  // Production:  install, env, schema migrate (opt-in), finish — no Docker, no seed.
  return mode === 'production' ? 4 : 6;
}

function installDependencies(pm: PackageManager, step: number, total: number): void {
  logStep(step, total, 'Installing dependencies...');

  const installCmd = pm === 'yarn' ? 'yarn' : pm;
  const installArgs = pm === 'yarn' ? [] : ['install'];

  if (!run(installCmd, installArgs)) {
    logError('Failed to install dependencies');
    process.exit(1);
  }

  logSuccess('Dependencies installed');
}

async function setupEnvironment(
  envConfig: EnvConfig,
  step: number,
  total: number,
  cli: CliOptions,
  envPath: string,
): Promise<void> {
  logStep(step, total, 'Creating environment file...');
  const rel = relative(ROOT, envPath);

  if (existsSync(envPath)) {
    const overwrite = cli.force
      ? true
      : cli.yes
        ? false
        : await promptYesNo(`${rel} already exists. Overwrite with new configuration?`, false);
    if (!overwrite) {
      logInfo(`Keeping existing ${rel}`);
      return;
    }
  }

  const content = generateEnvFileContent(envConfig);
  writeFileAtomic(envPath, content);
  logSuccess(`Created ${rel} with your configuration`);
}

/**
 * Returns `true` if the caller should continue to schema push, `false` if the
 * existing Postgres on the port is being reused (Docker skipped).
 */
async function setupDocker(
  envConfig: EnvConfig,
  step: number,
  total: number,
  cli: CliOptions,
): Promise<void> {
  logStep(step, total, 'Starting Docker containers...');

  const port = Number(envConfig.postgresPort);
  if (Number.isFinite(port) && (await isPortInUse(port))) {
    logWarning(
      `Port ${envConfig.postgresPort} is already in use — a Postgres may already be running.`,
    );
    const reuse = cli.yes
      ? true
      : await promptYesNo(
          `Reuse the service already listening on ${envConfig.postgresPort} instead of starting Docker?`,
          true,
        );
    if (reuse) {
      logInfo(
        `Reusing the existing service on ${envConfig.postgresPort}. ` +
          'Skipping Docker — ensure it accepts the configured credentials/database.',
      );
      return;
    }
    logError(
      `Port ${envConfig.postgresPort} is in use. Free it, or set POSTGRES_PORT to a free port and re-run.`,
    );
    logInfo('Find the holder with: lsof -i :' + envConfig.postgresPort + '  (or: ss -ltnp)');
    process.exit(1);
  }

  // Update docker compose env vars
  const envVars = {
    POSTGRES_USER: envConfig.postgresUser,
    POSTGRES_PASSWORD: envConfig.postgresPassword,
    POSTGRES_DB: envConfig.postgresDb,
    POSTGRES_PORT: envConfig.postgresPort,
  };

  // Start docker compose
  if (
    !run('docker', ['compose', '-f', DOCKER_COMPOSE, '--env-file', ENV_DEV, 'up', '-d'], {
      env: envVars,
    })
  ) {
    logError('Failed to start Docker containers');
    logInfo('Try running: docker compose -f infra/docker/development/docker-compose.dev.yml up -d');
    process.exit(1);
  }

  logSuccess('Docker containers started');

  // Wait for database health
  log('\n⏳ Waiting for database to be ready...');

  let retries = 30;
  let healthy = false;

  while (retries > 0) {
    // Resolve the container by compose service so this survives a renamed
    // project (container is <slug>-dev-postgres, not the old hardcoded name).
    const containerId = composeContainerId('postgres');
    if (containerId !== null) {
      const result = spawnSync(
        'docker',
        ['inspect', '--format', '{{.State.Health.Status}}', containerId],
        { stdio: 'pipe' },
      );
      if (result.stdout.toString().trim() === 'healthy') {
        healthy = true;
        break;
      }
    }

    process.stdout.write('.');
    await sleep(1000);
    retries--;
  }

  log('');

  if (!healthy) {
    logError('Database failed to become healthy');
    logInfo('Check logs with: docker compose logs postgres');
    process.exit(1);
  }

  logSuccess('Database is ready');
}

function skipDockerStep(step: number, total: number): void {
  logStep(step, total, 'Skipping Docker setup...');
  logWarning('Make sure your PostgreSQL database is running and accessible');
  logInfo('The connection will use the settings from config/env/.env.development');
}

function pushDatabaseSchema(pm: PackageManager, step: number, total: number): void {
  logStep(step, total, 'Migrating the database...');

  const envVars = parseEnvFile(ENV_DEV);

  if (!run(pm, ['db:migrate'], { env: envVars })) {
    logError('Failed to migrate the database');
    process.exit(1);
  }

  logSuccess('Database schema created');
}

/** Run migrations against the production (cloud) database described by .env.production. */
function migrateDatabaseSchema(pm: PackageManager, step: number, total: number): void {
  logStep(step, total, 'Migrating cloud database schema...');

  const envVars = { ...parseEnvFile(ENV_PROD), NODE_ENV: 'production', ENV_FILE: ENV_PROD };

  if (!run(pm, ['db:migrate'], { env: envVars })) {
    logError('Failed to migrate the cloud database');
    process.exit(1);
  }

  logSuccess('Cloud database migrated');
}

function seedDatabase(pm: PackageManager, step: number, total: number): void {
  logStep(step, total, 'Seeding database...');

  const envVars = parseEnvFile(ENV_DEV);

  if (!run(pm, ['db:seed'], { env: envVars })) {
    logError('Failed to seed database');
    process.exit(1);
  }

  logSuccess('Database seeded with test data');
}

function runCodeGenerators(pm: PackageManager, step: number, total: number): void {
  void pm;
  logStep(step, total, 'Finishing setup...');
  logInfo('Generated artifacts are validated by pnpm bslt gate merge and CI.');
}

function printSuccessMessage(pm: PackageManager, envConfig: EnvConfig): void {
  log('');
  log(color('╔════════════════════════════════════════════════════════════════╗', 'green'));
  log(
    color('║', 'green') +
      color('                    SETUP COMPLETE! 🎉                         ', 'bold') +
      color('║', 'green'),
  );
  log(color('╚════════════════════════════════════════════════════════════════╝', 'green'));
  log('');
  log(color('Your configuration:', 'bold'));

  log(
    `  Database: ${color(`PostgreSQL @ ${envConfig.postgresHost}:${envConfig.postgresPort}/${envConfig.postgresDb}`, 'dim')}`,
  );

  log(
    `  Email:    ${color(envConfig.emailProvider === 'console' ? 'Console (mock)' : 'SMTP', 'cyan')}`,
  );
  log(`  Storage:  ${color(envConfig.storageProvider, 'cyan')}`);
  log(`  API Port: ${color(envConfig.apiPort, 'cyan')}`);
  log('');
  log(color('Next steps:', 'bold'));
  log('');
  log(`  ${color('1.', 'cyan')} Start the development servers:`);
  log(`     ${color(`${pm} dev`, 'yellow')}`);
  log('');
  log(`  ${color('2.', 'cyan')} Open in your browser:`);
  log(`     ${color('http://localhost:5173', 'blue')} (Web App)`);
  log(`     ${color(`http://localhost:${envConfig.apiPort}`, 'blue')} (API Server)`);
  log('');

  log(`  ${color('3.', 'cyan')} Test credentials:`);
  log(`     Email:    ${color('admin@example.com', 'yellow')}`);
  log(`     Password: ${color('password123', 'yellow')}`);
  log('');

  log(color('Useful commands:', 'bold'));
  log(`  ${color(`${pm} dev`, 'dim')}            - Start all dev servers`);
  log(`  ${color(`${pm} dev:core`, 'dim')}       - Start server + web`);
  log(`  ${color(`${pm} --filter @bslt/web dev`, 'dim')}     - Start only web frontend`);
  log(`  ${color(`${pm} --filter @bslt/server dev`, 'dim')}  - Start only API server`);
  log(`  ${color(`${pm} test`, 'dim')}           - Run tests`);
  log(`  ${color(`${pm} build`, 'dim')}          - Build for production`);

  log(`  ${color(`${pm} db:reset`, 'dim')}       - Reset database to fresh state`);

  log('');
  log(color('Happy coding! 🚀', 'green'));
  log('');
}

function printProductionSuccessMessage(): void {
  log('');
  log(color('╔════════════════════════════════════════════════════════════════╗', 'green'));
  log(
    color('║', 'green') +
      color('              PRODUCTION CONFIG WRITTEN ✅                     ', 'bold') +
      color('║', 'green'),
  );
  log(color('╚════════════════════════════════════════════════════════════════╝', 'green'));
  log('');
  log(color('Next steps:', 'bold'));
  log(
    `  ${color('1.', 'cyan')} Review ${color('config/env/.env.production', 'blue')} and fill any remaining values.`,
  );
  log(
    `  ${color('2.', 'cyan')} Keep secrets out of git — supply them via your host's secret manager.`,
  );
  log(`     See ${color('docs/deploy/secrets-checklist.md', 'blue')}.`);
  log(
    `  ${color('3.', 'cyan')} Run ${color('pnpm db:migrate', 'dim')} against the cloud DB if you skipped it here.`,
  );
  log('');
}

/**
 * Production setup: gather a cloud configuration interactively, write
 * config/env/.env.production, and (opt-in) migrate the cloud database. No Docker,
 * no seed — production never spins up a local DB or loads fixtures.
 */
async function runProductionSetup(cli: CliOptions): Promise<void> {
  if (cli.yes) {
    throw new Error(
      'Production setup is interactive (cloud DB URL, HTTPS URLs, SMTP); --yes is not supported.',
    );
  }

  const options = await gatherOptions('quick', cli);
  const envConfig = await gatherProductionEnvConfig();

  log('');
  log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'dim'));
  log(color('                    SETUP SUMMARY', 'bold'));
  log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'dim'));
  log(`  Mode:            ${color('Production', 'cyan')}`);
  log(`  Package manager: ${color(options.packageManager, 'cyan')}`);
  log(`  Database:        ${color('Cloud (DATABASE_URL)', 'cyan')}`);
  log(`  Email:           ${color('SMTP', 'cyan')}`);
  log(`  Cache:           ${color(envConfig.cacheUseRedis ? 'Redis' : 'In-memory', 'cyan')}`);
  log('');

  const proceed = await promptYesNo('Proceed with setup?', true);
  if (!proceed) {
    log('\nSetup cancelled.');
    process.exit(0);
  }

  const totalSteps = getStepCount('production');
  let currentStep = 0;

  // Step 1: Install dependencies
  currentStep++;
  if (!options.skipInstall) {
    installDependencies(options.packageManager, currentStep, totalSteps);
  } else {
    logStep(currentStep, totalSteps, 'Skipping dependency installation...');
    logInfo('Using existing node_modules');
  }

  // Step 2: Write the production env file
  currentStep++;
  await setupEnvironment(envConfig, currentStep, totalSteps, cli, ENV_PROD);

  // Step 3: Schema migration against the cloud DB (opt-in, default No)
  currentStep++;
  if (cli.skipDb) {
    logStep(currentStep, totalSteps, 'Skipping cloud schema migration...');
  } else {
    const push = await promptYesNo('Push schema to the CLOUD database now?', false);
    if (push) {
      migrateDatabaseSchema(options.packageManager, currentStep, totalSteps);
    } else {
      logStep(currentStep, totalSteps, 'Skipping cloud schema migration...');
      logInfo('Run `pnpm db:migrate` against your cloud DB when ready.');
    }
  }

  // Step 4: Finish
  currentStep++;
  runCodeGenerators(options.packageManager, currentStep, totalSteps);

  printProductionSuccessMessage();
}

// =============================================================================
// Main
// =============================================================================

export async function main(argv: readonly string[] = []): Promise<void> {
  printBanner();

  try {
    const cli = parseCliOptions(argv);

    if (cli.mode === 'production') {
      await runProductionSetup(cli);
      return;
    }

    // Step 1: Select preset
    const preset = await selectPreset(cli);

    // Step 2: Gather options (package manager, skip install)
    const options = await gatherOptions(preset, cli);

    // Step 3: Get environment config based on preset
    let envConfig: EnvConfig;
    let useDocker = false;

    if (preset === 'custom') {
      envConfig = await gatherCustomEnvConfig();
      useDocker = !cli.skipDocker && envConfig.databaseUseDocker;
    } else {
      envConfig = getPresetConfig(preset);
      // Quick and Docker presets use local Docker services when available.
      useDocker = !cli.skipDocker && envConfig.databaseUseDocker && commandExists('docker');
    }

    // Summary before proceeding
    log('');
    log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'dim'));
    log(color('                    SETUP SUMMARY', 'bold'));
    log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'dim'));
    log(
      `  Preset:          ${color(preset === 'quick' ? 'Quick Start' : preset === 'docker' ? 'Docker Dev' : 'Custom', 'cyan')}`,
    );
    log(`  Package manager: ${color(options.packageManager, 'cyan')}`);
    log(`  Database:        ${color('PostgreSQL', 'cyan')}`);
    log(
      `  Email:           ${color(envConfig.emailProvider === 'console' ? 'Console (mock)' : 'SMTP', 'cyan')}`,
    );
    log(`  Storage:         ${color(envConfig.storageProvider, 'cyan')}`);
    log('');

    const proceed = cli.yes ? true : await promptYesNo('Proceed with setup?', true);
    if (!proceed) {
      log('\nSetup cancelled.');
      process.exit(0);
    }

    const totalSteps = getStepCount('development');
    let currentStep = 0;

    // Step 1: Install dependencies
    currentStep++;
    if (!options.skipInstall) {
      installDependencies(options.packageManager, currentStep, totalSteps);
    } else {
      logStep(currentStep, totalSteps, 'Skipping dependency installation...');
      logInfo('Using existing node_modules');
    }

    // Step 2: Setup environment file
    currentStep++;
    await setupEnvironment(envConfig, currentStep, totalSteps, cli, ENV_DEV);

    // Step 3: Docker (if available and selected)
    currentStep++;
    if (useDocker) {
      await setupDocker(envConfig, currentStep, totalSteps, cli);
    } else {
      skipDockerStep(currentStep, totalSteps);
    }

    // Step 4: Push database schema
    currentStep++;
    if (cli.skipDb) {
      logStep(currentStep, totalSteps, 'Skipping database schema push...');
    } else {
      pushDatabaseSchema(options.packageManager, currentStep, totalSteps);
    }

    // Step 5: Seed database
    currentStep++;
    if (cli.skipDb) {
      logStep(currentStep, totalSteps, 'Skipping database seed...');
    } else {
      seedDatabase(options.packageManager, currentStep, totalSteps);
    }

    // Final step: Run code generators
    currentStep++;
    runCodeGenerators(options.packageManager, currentStep, totalSteps);

    // Done!
    printSuccessMessage(options.packageManager, envConfig);
  } catch (error) {
    if (error instanceof Error && error.message.includes('readline was closed')) {
      log('\n\nSetup cancelled.');
    } else {
      logError(`Setup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  } finally {
    rl.close();
  }
}
