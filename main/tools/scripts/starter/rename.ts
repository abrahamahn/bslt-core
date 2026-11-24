// main/tools/scripts/starter/rename.ts
/**
 * Starter product rename helper.
 *
 * This command updates product-facing identity fields that a fresh clone should
 * own immediately. It intentionally leaves internal workspace package imports
 * such as @bslt/shared untouched; changing those aliases is a broader package
 * scope migration and should happen separately after the starter is running.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '../../lib/paths';

export interface StarterRenameOptions {
  readonly appName: string;
  readonly apply: boolean;
  readonly domain?: string | undefined;
  readonly packageScope?: string | undefined;
  readonly slug: string;
}

export interface StarterRenameCliOptions {
  readonly appName: string;
  readonly apply: boolean;
  readonly domain?: string | undefined;
  readonly packageScope?: string | undefined;
  readonly slug?: string | undefined;
}

export interface PlannedRenamePatch {
  readonly path: string;
  readonly description: string;
  readonly apply: (contents: string, options: StarterRenameOptions) => string;
}

export interface StarterRenamePlan {
  readonly options: StarterRenameOptions;
  readonly patches: readonly PlannedRenamePatch[];
  readonly manualFollowUps: readonly string[];
}

export interface StarterRenameApplyResult {
  readonly filesPatched: readonly string[];
}

const ENV_EXAMPLE_FILES = [
  'config/env/.env.development.example',
  'config/env/.env.local.example',
  'config/env/.env.test.example',
  'config/env/.env.production.example',
] as const;

const PRODUCT_DOC_FILES = ['README.md'] as const;

const DEPLOY_IDENTITY_FILES = [
  'docs/deploy/README.md',
  'docs/deploy/backup-restore.md',
  'docs/deploy/env.md',
  'docs/deploy/production-postgres.md',
  'docs/deploy/providers/digitalocean-auto-deploy.md',
  'docs/deploy/providers/digitalocean.md',
  'docs/deploy/providers/gcp.md',
  'docs/deploy/secrets-checklist.md',
  'docs/dev/staging.md',
  'infra/setup-github.sh',
  'infra/cloud/digitalocean/bootstrap-once.sh',
  'infra/cloud/digitalocean/variables.tf',
  'infra/cloud/gcp/variables.tf',
  'infra/cloud/main.tf',
  'infra/cloud/staging-setup.md',
  'infra/cloud/terraform.tfvars.example',
  'infra/cloud/variables.tf',
  'infra/docker/Dockerfile.web',
  'infra/docker/development/docker-compose.dev.yml',
  'infra/docker/development/docker-compose.yml',
  'infra/docker/production/docker-compose.prod.yml',
  'infra/runtime/caddy/Caddyfile',
  'infra/runtime/caddy/Caddyfile.dev',
  'infra/runtime/prometheus/alerts.yml',
  'infra/runtime/prometheus/prometheus.example.yml',
] as const;

const FEATURE_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/u;
/** npm package scope, e.g. `@acme`. Shared with the scope-rename migration tool. */
export const PACKAGE_SCOPE_PATTERN = /^@[a-z][a-z0-9-]*$/u;
const DOMAIN_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const TS_STRING_LITERAL_PATTERN = String.raw`(?:'[^'\n]*'|"(?:(?:\\.)|[^"\\\n])*")`;

export function usage(): string {
  return [
    'Usage: pnpm bslt rename <app-name> [--slug <slug>] [--domain <domain>] [--scope <scope>] [--apply]',
    '',
    'Examples:',
    '  pnpm bslt rename "Acme Cloud"',
    '  pnpm bslt rename "Acme Cloud" --domain acme.com --scope @acme --apply',
    '',
    'Options:',
    '  --apply          Write safe product identity changes. Without this, prints a dry run.',
    '  --domain         Production root domain, for example acme.com.',
    '  --scope          Desired package scope for the manual package-scope follow-up.',
    '  --slug           Kebab-case product slug. Defaults from the app name.',
    '  --help           Show this help text.',
  ].join('\n');
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-+/gu, '-');
}

function toDbName(slug: string): string {
  return slug.replaceAll('-', '_');
}

function assertEnvValue(name: string, value: string): void {
  if (value.includes('\n') || value.includes('\r') || value.includes('#')) {
    throw new Error(`${name} cannot contain newlines or "#".`);
  }
}

function assertAppName(value: string): void {
  assertEnvValue('App name', value);
  if (/[${}]/u.test(value)) {
    throw new Error(
      'App name cannot contain "$", "{", or "}" because it is used in Docker Compose defaults.',
    );
  }
}

function normalizeDomain(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const domain = value.trim().toLowerCase();
  if (domain === '') return undefined;
  if (domain.includes('://') || domain.includes('/')) {
    throw new Error(`Invalid domain "${value}". Use a bare domain, for example "acme.com".`);
  }
  if (!DOMAIN_PATTERN.test(domain)) {
    throw new Error(`Invalid domain "${value}". Use a bare domain, for example "acme.com".`);
  }
  return domain;
}

function normalizePackageScope(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const scope = value.trim().toLowerCase();
  if (scope === '') return undefined;
  if (!PACKAGE_SCOPE_PATTERN.test(scope)) {
    throw new Error(`Invalid package scope "${value}". Use a scope like "@acme".`);
  }
  return scope;
}

function normalizeOptions(options: StarterRenameCliOptions): StarterRenameOptions {
  const appName = options.appName.trim();
  if (appName === '') {
    throw new Error('Missing app name.');
  }
  assertAppName(appName);

  const slug = options.slug === undefined ? toSlug(appName) : options.slug.trim().toLowerCase();
  if (!FEATURE_NAME_PATTERN.test(slug)) {
    throw new Error(`Invalid slug "${slug}". Use kebab-case, for example "acme-cloud".`);
  }

  return {
    appName,
    apply: options.apply,
    domain: normalizeDomain(options.domain),
    packageScope: normalizePackageScope(options.packageScope),
    slug,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function setEnvValue(contents: string, key: string, value: string, filePath: string): string {
  assertEnvValue(key, value);
  const pattern = new RegExp(`^(${escapeRegex(key)}=)([^#\\n]*?)(\\s+#.*)?$`, 'mu');
  if (!pattern.test(contents)) {
    throw new Error(`Cannot patch ${filePath}; missing env key ${key}.`);
  }
  return contents.replace(
    pattern,
    (_match: string, prefix: string, _oldValue: string, suffix: string | undefined) => {
      return `${prefix}${value}${suffix ?? ''}`;
    },
  );
}

function replaceAllLiteral(contents: string, search: string, replacement: string): string {
  return contents.split(search).join(replacement);
}

function renderDockerfileString(value: string): string {
  return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

function renderYamlDoubleQuotedString(value: string): string {
  return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

function renderComposeInterpolationDefault(envKey: string, defaultValue: string): string {
  return `\${${envKey}:-${defaultValue}}`;
}

function renderComposeInterpolationString(envKey: string, defaultValue: string): string {
  return renderYamlDoubleQuotedString(renderComposeInterpolationDefault(envKey, defaultValue));
}

function githubOwnerFromScope(packageScope: string | undefined): string {
  return packageScope?.slice(1) ?? 'your-org';
}

function setTsStringProperty(
  contents: string,
  propertyName: string,
  value: string,
  filePath: string,
): string {
  const pattern = new RegExp(
    `(${escapeRegex(propertyName)}:\\s*)${TS_STRING_LITERAL_PATTERN}(,)`,
    'u',
  );
  if (!pattern.test(contents)) {
    throw new Error(`Cannot patch ${filePath}; missing string property ${propertyName}.`);
  }
  return contents.replace(pattern, (_match, prefix: string, suffix: string) => {
    return `${prefix}${JSON.stringify(value)}${suffix}`;
  });
}

function patchProductDoc(
  filePath: string,
  contents: string,
  options: StarterRenameOptions,
): string {
  let next = contents;
  const githubOwner = githubOwnerFromScope(options.packageScope);

  const replacements: readonly (readonly [string, string])[] = [
    ['# BSLT', `# ${options.appName}`],
    ['## Why BSLT', `## Why ${options.appName}`],
    [
      'BSLT is meant to be cloned, renamed, and turned into a product quickly.',
      `${options.appName} started as a clone-and-own SaaS starter and is ready to become a product.`,
    ],
    [
      'git clone https://github.com/abrahamahn/bslt.git',
      `git clone https://github.com/${githubOwner}/${options.slug}.git`,
    ],
    ['cd bslt', `cd ${options.slug}`],
    [
      'BSLT ships a production-safe **starter path** plus optional platform modules.',
      `${options.appName} ships a production-safe **starter path** plus optional platform modules.`,
    ],
    ['MIT © 2026 BSLT Contributors', `MIT © 2026 ${options.appName} Contributors`],
    [
      "Built by one developer who just wanted to ship faster.\nNow it's yours too.",
      'Built from a clone-and-own SaaS starter.\nMake it yours.',
    ],
  ];

  for (const [search, replacement] of replacements) {
    next = replaceAllLiteral(next, search, replacement);
  }

  if (next === contents) {
    throw new Error(`Cannot patch ${filePath}; no starter product doc anchors found.`);
  }

  return next;
}

function patchDeployIdentity(
  filePath: string,
  contents: string,
  options: StarterRenameOptions,
): string {
  const dbName = toDbName(options.slug);
  let next = contents;

  const replacements: readonly (readonly [string, string])[] = [
    ['starter-availability', `${options.slug}-availability`],
    ['starter-database', `${options.slug}-database`],
    ['starter-http', `${options.slug}-http`],
    ['starter-auth', `${options.slug}-auth`],
    ['starter-production', `${options.slug}-production`],
    ['starter-terraform-state', `${options.slug}-terraform-state`],
    ['starter-backups', `${options.slug}-backups`],
    ['starter-health', `${options.slug}-health`],
    ['starter-zone', `${options.slug}-zone`],
    ['starter-vm', `${options.slug}-vm`],
    ['starter-prod', `${options.slug}-prod`],
    ['starter-dev', `${options.slug}-dev`],
    ['starter-caddy', `${options.slug}-caddy`],
    ['starter-postgres', `${options.slug}-postgres`],
    ['starter-pgbouncer', `${options.slug}-pgbouncer`],
    ['starter-redis', `${options.slug}-redis`],
    ['starter-uploads', `${options.slug}-uploads`],
    ['starter-api', `${options.slug}-api`],
    ['starter-web', `${options.slug}-web`],
    ['starter.service', `${options.slug}.service`],
    ['your-org/starter', `your-org/${options.slug}`],
    ['Starter GitHub Repository Setup', `${options.appName} GitHub Repository Setup`],
    ['Starter IaC', `${options.appName} IaC`],
    [
      'Production Caddy Configuration for Starter',
      `Production Caddy Configuration for ${options.appName}`,
    ],
    [
      'Development Caddy Configuration for Starter',
      `Development Caddy Configuration for ${options.appName}`,
    ],
    ['Starter API', `${options.appName} API`],
    ['/home/deploy/starter', `/home/deploy/${options.slug}`],
    ['~/starter', `~/${options.slug}`],
    ['cd starter', `cd ${options.slug}`],
    ['deploy@your-app.com', `deploy@${options.domain ?? 'your-app.com'}`],
    ['--app-name starter', `--app-name ${options.slug}`],
    ['APP_NAME="starter"', `APP_NAME="${options.slug}"`],
    ['app_name = "starter"', `app_name = "${options.slug}"`],
    ['default     = "starter"', `default     = "${options.slug}"`],
    ['app_production', `${dbName}_prod`],
    ['app_dev', `${dbName}_dev`],
    ['app_test', `${dbName}_test`],
    [
      'ARG VITE_APP_NAME="Your App"',
      `ARG VITE_APP_NAME=${renderDockerfileString(options.appName)}`,
    ],
    [
      '"${EMAIL_FROM_NAME:-Your App}"',
      renderComposeInterpolationString('EMAIL_FROM_NAME', options.appName),
    ],
    [
      '"${VITE_APP_NAME:-Your App}"',
      renderComposeInterpolationString('VITE_APP_NAME', options.appName),
    ],
    [
      '${EMAIL_FROM_NAME:-Your App}',
      renderComposeInterpolationDefault('EMAIL_FROM_NAME', options.appName),
    ],
    [
      '${VITE_APP_NAME:-Your App}',
      renderComposeInterpolationDefault('VITE_APP_NAME', options.appName),
    ],
    ['starter API', `${options.slug} API`],
  ];

  for (const [search, replacement] of replacements) {
    next = replaceAllLiteral(next, search, replacement);
  }

  if (options.domain !== undefined) {
    next = replaceAllLiteral(next, 'api.your-app.com', options.domain);
    next = replaceAllLiteral(next, 'smtp.mail.your-app.com', `smtp.mail.${options.domain}`);
    next = replaceAllLiteral(next, 'mailer@your-app.com', `mailer@${options.domain}`);
    next = replaceAllLiteral(next, 'your-app.com', options.domain);
    next = replaceAllLiteral(next, 'app.example.com', options.domain);
    next = replaceAllLiteral(next, 'preview.example.com', `preview.${options.domain}`);
  }

  if (next === contents) {
    throw new Error(`Cannot patch ${filePath}; no starter deploy identity anchors found.`);
  }

  return next;
}

function patchEnvExample(
  filePath: string,
  contents: string,
  options: StarterRenameOptions,
): string {
  const dbName = toDbName(options.slug);
  const dbSuffix = filePath.includes('.env.test.')
    ? 'test'
    : filePath.includes('.env.production.')
      ? 'prod'
      : 'dev';
  let next = contents;

  next = setEnvValue(next, 'APP_NAME', options.appName, filePath);
  next = setEnvValue(next, 'VITE_APP_NAME', options.appName, filePath);
  next = setEnvValue(next, 'TOTP_ISSUER', options.appName, filePath);
  next = setEnvValue(next, 'EMAIL_FROM_NAME', options.appName, filePath);
  next = setEnvValue(next, 'JWT_ISSUER', options.slug, filePath);
  next = setEnvValue(next, 'JWT_AUDIENCE', `${options.slug}-api`, filePath);
  next = setEnvValue(next, 'POSTGRES_DB', `${dbName}_${dbSuffix}`, filePath);

  if (options.domain !== undefined && filePath.includes('.env.production.')) {
    const appUrl = `https://${options.domain}`;
    const apiUrl = appUrl;
    next = setEnvValue(next, 'API_BASE_URL', apiUrl, filePath);
    next = setEnvValue(next, 'APP_URL', appUrl, filePath);
    next = replaceAllLiteral(
      next,
      '# VITE_API_URL=https://api.your-app.com',
      `# VITE_API_URL=https://api.${options.domain}`,
    );
    next = setEnvValue(
      next,
      'GOOGLE_CALLBACK_URL',
      `${apiUrl}/api/auth/oauth/google/callback`,
      filePath,
    );
    next = setEnvValue(
      next,
      'GITHUB_CALLBACK_URL',
      `${apiUrl}/api/auth/oauth/github/callback`,
      filePath,
    );
    next = setEnvValue(next, 'EMAIL_FROM_ADDRESS', `no-reply@${options.domain}`, filePath);
    next = setEnvValue(next, 'EMAIL_REPLY_TO', `support@${options.domain}`, filePath);
    next = setEnvValue(next, 'SMTP_HOST', `smtp.mail.${options.domain}`, filePath);
  }

  return next;
}

function patchSetupDefaults(contents: string, options: StarterRenameOptions): string {
  const filePath = 'main/tools/scripts/dev/setup.ts';
  const dbName = toDbName(options.slug);
  let next = contents;

  next = setTsStringProperty(next, 'postgresDb', `${dbName}_dev`, filePath);
  next = setTsStringProperty(next, 'viteAppName', options.appName, filePath);
  next = setTsStringProperty(next, 'emailFromName', options.appName, filePath);
  if (options.domain !== undefined) {
    next = setTsStringProperty(next, 'emailFromAddress', `no-reply@${options.domain}`, filePath);
  }
  next = setEnvValue(next, 'JWT_ISSUER', options.slug, filePath);
  next = setEnvValue(next, 'JWT_AUDIENCE', `${options.slug}-api`, filePath);

  return next;
}

function plannedPatches(): PlannedRenamePatch[] {
  return [
    ...ENV_EXAMPLE_FILES.map((filePath) => ({
      path: filePath,
      description: 'Update product-facing env defaults.',
      apply: (contents: string, options: StarterRenameOptions) =>
        patchEnvExample(filePath, contents, options),
    })),
    {
      path: 'main/tools/scripts/dev/setup.ts',
      description: 'Update bootstrap defaults for newly generated local env files.',
      apply: patchSetupDefaults,
    },
    ...PRODUCT_DOC_FILES.map((filePath) => ({
      path: filePath,
      description: 'Update root README product identity and clone instructions.',
      apply: (contents: string, options: StarterRenameOptions) =>
        patchProductDoc(filePath, contents, options),
    })),
    ...DEPLOY_IDENTITY_FILES.map((filePath) => ({
      path: filePath,
      description:
        'Update safe Docker, Terraform, Prometheus, and deploy-documentation identity defaults.',
      apply: (contents: string, options: StarterRenameOptions) =>
        patchDeployIdentity(filePath, contents, options),
    })),
  ];
}

function manualFollowUps(options: StarterRenameOptions): string[] {
  const packageScope = options.packageScope ?? '@your-org';
  return [
    `Package imports still use @bslt/* internally. Run "pnpm bslt rename scope ${packageScope} --apply" to migrate the whole workspace scope (package.json names/deps, tsconfig paths, Vite/Vitest/turbo/eslint config, and every source import), then "pnpm install" to regenerate the lockfile.`,
    'Replace logos, favicons, social images, and any provider-specific hostnames that are not covered by the safe rename pass.',
    'Rotate any local secrets after renaming and before sharing the fork.',
  ];
}

export function createStarterRenamePlan(options: StarterRenameCliOptions): StarterRenamePlan {
  const normalized = normalizeOptions(options);
  return {
    options: normalized,
    patches: plannedPatches(),
    manualFollowUps: manualFollowUps(normalized),
  };
}

export function parseStarterRenameArgs(args: readonly string[]): StarterRenameCliOptions {
  let appName: string | undefined;
  let apply = false;
  let domain: string | undefined;
  let packageScope: string | undefined;
  let slug: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      apply = false;
      continue;
    }
    if (arg === '--domain' || arg === '--scope' || arg === '--slug' || arg === '--name') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}.`);
      }
      index += 1;
      if (arg === '--domain') domain = value;
      if (arg === '--scope') packageScope = value;
      if (arg === '--slug') slug = value;
      if (arg === '--name') appName = value;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown argument "${arg}".`);
    }
    if (appName !== undefined) {
      throw new Error(`Expected one app name, got "${appName}" and "${arg}".`);
    }
    appName = arg;
  }

  if (appName === undefined) {
    throw new Error(`Missing app name.\n\n${usage()}`);
  }

  return { appName, apply, domain, packageScope, slug };
}

function repoPath(repoRoot: string, filePath: string): string {
  return path.join(repoRoot, filePath);
}

export function applyStarterRenamePlan(
  plan: StarterRenamePlan,
  repoRoot: string = REPO_ROOT,
): StarterRenameApplyResult {
  const patchedContents = plan.patches.map((patch) => {
    const absolutePath = repoPath(repoRoot, patch.path);
    if (!existsSync(absolutePath)) {
      throw new Error(`Cannot patch missing file: ${patch.path}`);
    }
    return {
      path: patch.path,
      contents: patch.apply(readFileSync(absolutePath, 'utf8'), plan.options),
    };
  });

  for (const patch of patchedContents) {
    writeFileSync(repoPath(repoRoot, patch.path), patch.contents, 'utf8');
  }

  return { filesPatched: plan.patches.map((patch) => patch.path) };
}

function renderPlan(plan: StarterRenamePlan): string {
  const mode = plan.options.apply ? 'apply' : 'dry run';
  const domainLine = plan.options.domain === undefined ? [] : [`  Domain: ${plan.options.domain}`];
  const scopeLine =
    plan.options.packageScope === undefined
      ? []
      : [`  Desired package scope: ${plan.options.packageScope}`];

  return [
    `${plan.options.appName} starter rename`,
    '',
    `Mode: ${mode}${plan.options.apply ? '' : ' (pass --apply to write changes)'}`,
    '',
    'Product identity:',
    `  App name: ${plan.options.appName}`,
    `  Slug: ${plan.options.slug}`,
    `  JWT issuer: ${plan.options.slug}`,
    `  JWT audience: ${plan.options.slug}-api`,
    ...domainLine,
    ...scopeLine,
    '',
    'Files to patch:',
    ...plan.patches.map((patch) => `  ${patch.path} - ${patch.description}`),
    '',
    'Manual follow-ups:',
    ...plan.manualFollowUps.map((item) => `  ${item}`),
  ].join('\n');
}

function renderApplyResult(plan: StarterRenamePlan, result: StarterRenameApplyResult): string {
  return [
    `${plan.options.appName} starter rename applied`,
    '',
    'Patched:',
    ...result.filesPatched.map((file) => `  ${file}`),
    '',
    'Manual follow-ups:',
    ...plan.manualFollowUps.map((item) => `  ${item}`),
    '',
    'Next command:',
    '  pnpm bslt gate merge',
  ].join('\n');
}

export function runStarterRenameCli(args: readonly string[] = []): void {
  const options = parseStarterRenameArgs(args);
  const plan = createStarterRenamePlan(options);

  if (!plan.options.apply) {
    console.log(renderPlan(plan));
    return;
  }

  const result = applyStarterRenamePlan(plan);
  console.log(renderApplyResult(plan, result));
}
