// main/tools/scripts/audit/local-env-secrets.ts
/**
 * Checks ignored local env files for release-blocking secret material.
 *
 * This intentionally stays out of starter:verify because product forks may have
 * legitimate local secrets. Run it before preparing a public template release.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { fail, pass, type CheckResult } from '../../gates/types';
import { parseActiveEnvAssignments, type EnvAssignment } from '../../lib/env-file';
import { REPO_ROOT } from '../../lib/paths';

export interface LocalEnvSecretIssue {
  readonly file: string;
  readonly key: string;
  readonly line: number;
  readonly message: string;
}

const LOCAL_ENV_FILES = [
  'config/env/.env.development',
  'config/env/.env.local',
  'config/env/.env.test',
  'config/env/.env.production',
] as const;

const PROVIDER_CREDENTIAL_KEYS: ReadonlySet<string> = new Set([
  'APPLE_PRIVATE_KEY',
  'APPLE_PRIVATE_KEY_BASE64',
  'EMAIL_API_KEY',
  'FACEBOOK_CLIENT_SECRET',
  'GITHUB_CLIENT_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'MICROSOFT_CLIENT_SECRET',
  'ONESIGNAL_REST_API_KEY',
  'ONESIGNAL_USER_AUTH_KEY',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
  'REDIS_PASSWORD',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'SMTP_PASS',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
] as const);

const PRODUCTION_CREDENTIAL_KEYS: ReadonlySet<string> = new Set([
  'COOKIE_SECRET',
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_SECRET_PREVIOUS',
  'OAUTH_TOKEN_ENCRYPTION_KEY',
  'POSTGRES_PASSWORD',
  'SMTP_USER',
  ...PROVIDER_CREDENTIAL_KEYS,
] as const);

const ALLOWED_LOCAL_PLACEHOLDER_VALUES = new Map<string, ReadonlySet<string>>([
  ['COOKIE_SECRET', new Set(['localCookieSigningKeyMinimum32Characters'])],
  ['JWT_SECRET', new Set(['localJwtSigningKeyMinimum32Characters'])],
  ['POSTGRES_PASSWORD', new Set(['development', 'postgres'])],
]);

function isProductionEnvFile(file: string): boolean {
  return file === 'config/env/.env.production';
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function allowedLocalPlaceholder(assignment: EnvAssignment): boolean {
  const allowedValues = ALLOWED_LOCAL_PLACEHOLDER_VALUES.get(assignment.key);
  return allowedValues?.has(assignment.value) === true;
}

function shouldFlagAssignment(file: string, assignment: EnvAssignment): boolean {
  if (!isNonEmpty(assignment.value)) return false;

  if (isProductionEnvFile(file)) {
    return PRODUCTION_CREDENTIAL_KEYS.has(assignment.key);
  }

  if (PROVIDER_CREDENTIAL_KEYS.has(assignment.key)) return true;
  if (assignment.key === 'DATABASE_URL') return true;
  if (assignment.key === 'OAUTH_TOKEN_ENCRYPTION_KEY') return true;

  if (ALLOWED_LOCAL_PLACEHOLDER_VALUES.has(assignment.key)) {
    return !allowedLocalPlaceholder(assignment);
  }

  return false;
}

function issueMessage(file: string, key: string): string {
  if (isProductionEnvFile(file)) {
    return `${key} must be blank in ignored production env files before template release.`;
  }

  if (PROVIDER_CREDENTIAL_KEYS.has(key)) {
    return `${key} must be blank in ignored local env files before template release.`;
  }

  return `${key} must use a documented non-production placeholder or be blank before template release.`;
}

export function auditLocalEnvSecretContent(content: string, file: string): LocalEnvSecretIssue[] {
  return parseActiveEnvAssignments(content)
    .filter((assignment) => shouldFlagAssignment(file, assignment))
    .map((assignment) => ({
      file,
      key: assignment.key,
      line: assignment.line,
      message: issueMessage(file, assignment.key),
    }));
}

export function auditLocalEnvSecrets(root = REPO_ROOT): LocalEnvSecretIssue[] {
  const issues: LocalEnvSecretIssue[] = [];

  for (const file of LOCAL_ENV_FILES) {
    const absolutePath = path.join(root, file);
    if (!existsSync(absolutePath)) continue;
    issues.push(...auditLocalEnvSecretContent(readFileSync(absolutePath, 'utf8'), file));
  }

  return issues;
}

function formatIssue(issue: LocalEnvSecretIssue): string {
  return `${issue.file}:${String(issue.line)} ${issue.key} ${issue.message}`;
}

export function run(): CheckResult {
  const issues = auditLocalEnvSecrets();

  if (issues.length > 0) {
    console.error('Ignored env secret material detected:');
    for (const issue of issues) {
      console.error(`- ${formatIssue(issue)}`);
    }
    console.error(
      'Values are intentionally not printed. Blank them locally and rotate externally.',
    );
    return fail(`${String(issues.length)} secret value(s) in ignored env files`);
  }

  return pass(`no secret material in ${String(LOCAL_ENV_FILES.length)} local env paths`);
}
