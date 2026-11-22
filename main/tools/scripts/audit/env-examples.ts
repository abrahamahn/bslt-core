// main/tools/scripts/audit/env-examples.ts
/**
 * Validates checked-in environment templates against the runtime config loader.
 *
 * Env examples keep real secrets blank, so the audit overlays synthetic values
 * before validating each template's shape.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { load } from '../../../kernel/server/src/config/factory';
import { fail, pass, type CheckResult } from '../../gates/types';
import { PATHS } from '../../lib/paths';

type EnvMap = Record<string, string>;

const COPY_RUN_EXAMPLES = [
  '.env.development.example',
  '.env.local.example',
  '.env.test.example',
] as const;

const SECRET_OVERLAY: EnvMap = {
  JWT_SECRET: 'templateJwtSigningKeyMinimum32Characters',
  COOKIE_SECRET: 'templateCookieSigningKeyMinimum32Characters',
  OAUTH_TOKEN_ENCRYPTION_KEY: 'templateOauthTokenEncryptionKey32Characters',
};

const PRODUCTION_OVERLAY: EnvMap = {
  ...SECRET_OVERLAY,
  EMAIL_FROM_ADDRESS: 'no-reply@your-app.test',
  EMAIL_REPLY_TO: 'support@your-app.test',
  // What the running API receives (docs/deploy/env.md#database-roles): its two
  // role URLs and the worker's direct pub/sub URL, and never the superuser
  // password. Validating the POSTGRES_* parts as the app connection would bless
  // the one setup production refuses.
  DATABASE_URL: 'postgresql://bslt_app:template-app-password@pgbouncer:5432/app_prod',
  WORKER_DATABASE_URL: 'postgresql://bslt_worker:template-worker-password@pgbouncer:5432/app_prod',
  LISTEN_DATABASE_URL:
    'postgresql://bslt_worker:template-worker-password@db.internal.test:5432/app_prod',
  POSTGRES_PASSWORD: '',
  SMTP_HOST: 'smtp.mail.your-app.test',
  SMTP_USER: 'smtp-user',
  SMTP_PASS: 'smtp-password',
};

/**
 * The role URLs the production template must declare. The overlay above
 * supplies three of them, so without this check the template could lose a line
 * and still validate.
 */
const PRODUCTION_DATABASE_ROLE_KEYS = [
  'DATABASE_URL',
  'WORKER_DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'LISTEN_DATABASE_URL',
] as const;

const FORBIDDEN_TEMPLATE_DEFAULTS = [
  { label: 'BSLT public domain', pattern: /\b(?:api\.|demo\.)?bslt\.dev\b/iu },
  { label: 'BSLT database name', pattern: /\bbslt_(?:dev|test|demo)\b/iu },
  { label: 'personal Gmail address', pattern: /\bsatmorningrain@gmail\.com\b/iu },
  { label: 'Gmail SMTP host', pattern: /\bsmtp\.gmail\.com\b/iu },
] as const;

const FORBIDDEN_ACTIVE_DATABASE_KEYS = [
  'JSON_DB_PATH',
  'JSON_DB_PERSIST_ON_WRITE',
  'MONGODB_CONNECTION_STRING',
  'MONGODB_DATABASE',
  'MONGODB_DB',
  'MONGODB_SSL',
  'MONGODB_CONNECT_TIMEOUT_MS',
  'MONGODB_SOCKET_TIMEOUT_MS',
  'MONGODB_USE_UNIFIED_TOPOLOGY',
  'SQLITE_FILE_PATH',
  'SQLITE_WAL_MODE',
  'SQLITE_FOREIGN_KEYS',
  'SQLITE_TIMEOUT_MS',
] as const;

const BLANK_INLINE_COMMENT_PATTERN = /^[A-Z][A-Z0-9_]*=\s+#/u;

function assertNoProjectSpecificDefaults(fileName: string, content: string): void {
  for (const { label, pattern } of FORBIDDEN_TEMPLATE_DEFAULTS) {
    if (pattern.test(content)) {
      throw new Error(
        `${fileName} contains a project-specific ${label}; use neutral placeholders.`,
      );
    }
  }
}

function assertNoBlankInlineComments(fileName: string, content: string): void {
  const lines = content.split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    if (BLANK_INLINE_COMMENT_PATTERN.test(line)) {
      throw new Error(
        `${fileName}:${String(index + 1)} assigns a blank env value with an inline comment; put the comment on the line above.`,
      );
    }
  }
}

function assertStarterDatabaseDefaults(fileName: string, env: EnvMap): void {
  if (env['DATABASE_PROVIDER'] !== 'postgresql') {
    throw new Error(`${fileName} must keep DATABASE_PROVIDER=postgresql for starter defaults.`);
  }

  for (const key of FORBIDDEN_ACTIVE_DATABASE_KEYS) {
    if (env[key] !== undefined) {
      throw new Error(
        `${fileName} must not activate ${key}; non-Postgres database adapters are extension points, not starter defaults.`,
      );
    }
  }
}

function assertProductionFrontendDefaults(fileName: string, env: EnvMap): void {
  if (fileName !== '.env.production.example') return;

  if (env['VITE_API_URL'] !== undefined) {
    throw new Error(
      `${fileName} must leave VITE_API_URL commented or absent so the bundled Caddy deployment uses relative /api URLs.`,
    );
  }
}

function assertProductionDatabaseRoles(fileName: string, env: EnvMap): void {
  if (fileName !== '.env.production.example') return;

  for (const key of PRODUCTION_DATABASE_ROLE_KEYS) {
    if (env[key] === undefined) {
      throw new Error(
        `${fileName} must declare ${key}; the database role split needs every role URL (docs/deploy/env.md#database-roles).`,
      );
    }
    if (env[key] !== '') {
      throw new Error(
        `${fileName} must leave ${key} blank; a role URL carries that role's password.`,
      );
    }
  }
}

function assertProductionEmailDefaults(fileName: string, env: EnvMap): void {
  if (fileName !== '.env.production.example') return;

  const forbiddenDefaults: readonly (readonly [string, string])[] = [
    ['EMAIL_FROM_ADDRESS', 'no-reply@example.com'],
    ['EMAIL_REPLY_TO', 'support@example.com'],
    ['SMTP_HOST', 'smtp.example.com'],
  ];

  for (const [key, forbiddenValue] of forbiddenDefaults) {
    if (env[key] === forbiddenValue) {
      throw new Error(
        `${fileName} must leave ${key} blank; production email values must be supplied by the deployer.`,
      );
    }
  }
}

function parseEnvFile(filePath: string): EnvMap {
  const content = readFileSync(filePath, 'utf8');
  const env: EnvMap = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));

    if (!isQuoted) {
      value = value.replace(/\s+#.*$/, '').trim();
    } else {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function validateExample(envDir: string, fileName: string, overlay: EnvMap = {}): void {
  const filePath = resolve(envDir, fileName);
  const content = readFileSync(filePath, 'utf8');
  assertNoProjectSpecificDefaults(fileName, content);
  assertNoBlankInlineComments(fileName, content);
  const parsedEnv = parseEnvFile(filePath);
  assertStarterDatabaseDefaults(fileName, parsedEnv);
  assertProductionFrontendDefaults(fileName, parsedEnv);
  assertProductionDatabaseRoles(fileName, parsedEnv);
  assertProductionEmailDefaults(fileName, parsedEnv);
  const env = {
    ...parsedEnv,
    ...overlay,
  };

  load(env);
  console.log(`ok ${fileName}`);
}

/**
 * Validates every env template; the first defect fails the check.
 *
 * @param envDir - The directory holding the templates (default `config/env`).
 */
export function run(envDir: string = PATHS.envDir): CheckResult {
  const checked: string[] = [];
  try {
    for (const fileName of COPY_RUN_EXAMPLES) {
      validateExample(envDir, fileName, SECRET_OVERLAY);
      checked.push(fileName);
    }
    validateExample(envDir, '.env.production.example', PRODUCTION_OVERLAY);
    checked.push('.env.production.example');
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  return pass(`${String(checked.length)} env templates load through the runtime config`);
}
