// main/tools/scripts/starter/rename.test.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { applyStarterRenamePlan, createStarterRenamePlan, parseStarterRenameArgs } from './rename';

const tempRoots: string[] = [];

const DEPLOY_FIXTURE_FILES = [
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

function writeFixture(root: string, filePath: string, contents: string): void {
  const absolutePath = path.join(root, filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, 'utf8');
}

function readFixture(root: string, filePath: string): string {
  return readFileSync(path.join(root, filePath), 'utf8');
}

function renderEnvExample(kind: 'development' | 'local' | 'test' | 'production'): string {
  const localApiPort = kind === 'test' ? '3001' : '8080';
  const localAppPort = kind === 'test' ? '3000' : '5173';
  const isProduction = kind === 'production';
  const apiBaseUrl = isProduction
    ? 'https://your-app.com/  # REQUIRED: Set in deployment'
    : `http://localhost:${localApiPort}`;
  const appUrl = isProduction
    ? 'https://your-app.com/  # REQUIRED: Set in deployment'
    : `http://localhost:${localAppPort}`;
  const viteApiUrl = isProduction ? undefined : `http://localhost:${localApiPort}`;
  const dbName =
    kind === 'test' ? 'app_test' : kind === 'production' ? 'app_production' : 'app_dev';
  const emailAddress = isProduction
    ? ''
    : 'no-reply@example.com  # Set your production from address';
  const smtpHost = isProduction ? '' : 'smtp.example.com';

  return [
    'APP_NAME=Your App',
    `API_BASE_URL=${apiBaseUrl}`,
    `APP_URL=${appUrl}`,
    ...(viteApiUrl === undefined
      ? ['# VITE_API_URL=https://api.your-app.com']
      : [`VITE_API_URL=${viteApiUrl}`]),
    'VITE_APP_NAME=Your App',
    'JWT_ISSUER=your-app',
    'JWT_AUDIENCE=your-app-api',
    'TOTP_ISSUER=Your App',
    `GOOGLE_CALLBACK_URL=${isProduction ? 'https://your-app.com' : `http://localhost:${localApiPort}`}/api/auth/oauth/google/callback`,
    `GITHUB_CALLBACK_URL=${isProduction ? 'https://your-app.com' : `http://localhost:${localApiPort}`}/api/auth/oauth/github/callback`,
    `KAKAO_CALLBACK_URL=${isProduction ? 'https://your-app.com' : `http://localhost:${localApiPort}`}/api/auth/oauth/kakao/callback`,
    `POSTGRES_DB=${dbName}`,
    'EMAIL_FROM_NAME=Your App',
    `EMAIL_FROM_ADDRESS=${emailAddress}`,
    `EMAIL_REPLY_TO=${isProduction ? '' : 'support@example.com'}`,
    `SMTP_HOST=${smtpHost}`,
    '',
  ].join('\n');
}

function createFixtureRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'bslt-starter-rename-'));
  tempRoots.push(root);

  for (const kind of ['development', 'local', 'test', 'production'] as const) {
    writeFixture(root, `config/env/.env.${kind}.example`, renderEnvExample(kind));
  }

  writeFixture(
    root,
    'main/tools/scripts/dev/setup.ts',
    [
      'const QUICK_START_ENV = {',
      "  postgresDb: 'app_dev',",
      "  viteAppName: 'Your App',",
      "  emailFromName: 'Your App',",
      "  emailFromAddress: 'noreply@example.com',",
      '};',
      '',
      'const generated = `',
      'JWT_ISSUER=your-app',
      'JWT_AUDIENCE=your-app-api',
      '`;',
      '',
    ].join('\n'),
  );

  writeFixture(
    root,
    'README.md',
    [
      '# BSLT',
      '',
      '**A clone-and-own SaaS starter with production-safe defaults.**',
      '',
      'BSLT is meant to be cloned, renamed, and turned into a product quickly. The default starter path is intentionally small.',
      '',
      '## Why BSLT',
      '',
      '```bash',
      'git clone https://github.com/abrahamahn/bslt.git',
      'cd bslt',
      'pnpm install',
      '```',
      '',
      'BSLT ships a production-safe **starter path** plus optional platform modules.',
      '',
      'MIT © 2026 BSLT Contributors',
      '',
      'Built by one developer who just wanted to ship faster.',
      "Now it's yours too.",
      '',
    ].join('\n'),
  );

  for (const filePath of DEPLOY_FIXTURE_FILES) {
    writeFixture(
      root,
      filePath,
      [
        'name: starter-prod',
        'container_name: starter-api',
        'volume: starter-postgres-data',
        'service: starter.service',
        'repo: your-org/starter',
        'setup: Starter GitHub Repository Setup Starter IaC',
        'path: /home/deploy/starter',
        'shell: cd starter',
        'ssh: deploy@your-app.com',
        'database: app_production app_dev app_test',
        [
          'caddy: Production Caddy Configuration for Starter',
          'Development Caddy Configuration for Starter',
        ].join(' '),
        'terraform_bucket: starter-terraform-state',
        'gcp: starter-vm starter-zone starter-health starter-backups',
        'bootstrap: APP_NAME="starter" --app-name starter',
        'tfvars: app_name = "starter"',
        'variable_default: default     = "starter"',
        'vite_arg: ARG VITE_APP_NAME="Your App"',
        'compose_fallbacks: "${EMAIL_FROM_NAME:-Your App}" "${VITE_APP_NAME:-Your App}"',
        [
          'domains: https://your-app.com https://your-app.com',
          'smtp.mail.your-app.com mailer@your-app.com app.example.com preview.example.com',
        ].join(' '),
        [
          'prometheus: starter-api starter-availability starter-http',
          'starter-database starter-auth Starter API starter API',
        ].join(' '),
        '',
      ].join('\n'),
    );
  }

  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('starter rename helper', () => {
  it('derives safe identity defaults from an app name', () => {
    const plan = createStarterRenamePlan({ appName: 'Acme Cloud', apply: false });

    expect(plan.options).toMatchObject({
      appName: 'Acme Cloud',
      apply: false,
      slug: 'acme-cloud',
    });
    expect(plan.patches.map((patch) => patch.path)).toContain('config/env/.env.production.example');
    expect(plan.patches.map((patch) => patch.path)).toContain(
      'infra/docker/production/docker-compose.prod.yml',
    );
    expect(plan.patches.map((patch) => patch.path)).toContain('README.md');
  });

  it('parses CLI options', () => {
    expect(
      parseStarterRenameArgs([
        'Acme Cloud',
        '--slug',
        'acme',
        '--domain',
        'acme.com',
        '--scope',
        '@acme',
        '--apply',
      ]),
    ).toEqual({
      appName: 'Acme Cloud',
      apply: true,
      domain: 'acme.com',
      packageScope: '@acme',
      slug: 'acme',
    });
  });

  it('rejects unsafe names, slugs, domains, and scopes', () => {
    expect(() => createStarterRenamePlan({ appName: 'Bad#Name', apply: false })).toThrow(
      'App name',
    );
    expect(() =>
      createStarterRenamePlan({ appName: 'Acme', apply: false, slug: 'Bad Slug' }),
    ).toThrow('Invalid slug');
    expect(() =>
      createStarterRenamePlan({ appName: 'Acme', apply: false, domain: 'https://acme.com' }),
    ).toThrow('Invalid domain');
    expect(() =>
      createStarterRenamePlan({ appName: 'Acme', apply: false, packageScope: 'acme' }),
    ).toThrow('Invalid package scope');
    expect(() => createStarterRenamePlan({ appName: 'Bad$Name', apply: false })).toThrow(
      'Docker Compose',
    );
  });

  it('applies product identity to safe starter files', () => {
    const root = createFixtureRepo();
    const plan = createStarterRenamePlan({
      appName: 'Acme Cloud',
      apply: true,
      domain: 'acme.com',
      packageScope: '@acme',
    });

    const result = applyStarterRenamePlan(plan, root);

    expect(result.filesPatched).toContain('config/env/.env.development.example');
    expect(result.filesPatched).toContain('main/tools/scripts/dev/setup.ts');

    const developmentEnv = readFixture(root, 'config/env/.env.development.example');
    expect(developmentEnv).toContain('APP_NAME=Acme Cloud');
    expect(developmentEnv).toContain('VITE_APP_NAME=Acme Cloud');
    expect(developmentEnv).toContain('JWT_ISSUER=acme-cloud');
    expect(developmentEnv).toContain('JWT_AUDIENCE=acme-cloud-api');
    expect(developmentEnv).toContain('TOTP_ISSUER=Acme Cloud');
    expect(developmentEnv).toContain('POSTGRES_DB=acme_cloud_dev');
    expect(developmentEnv).toContain('EMAIL_FROM_NAME=Acme Cloud');
    expect(developmentEnv).toContain('EMAIL_FROM_ADDRESS=no-reply@example.com');

    const testEnv = readFixture(root, 'config/env/.env.test.example');
    expect(testEnv).toContain('POSTGRES_DB=acme_cloud_test');

    const productionEnv = readFixture(root, 'config/env/.env.production.example');
    expect(productionEnv).toContain('API_BASE_URL=https://acme.com  # REQUIRED: Set in deployment');
    expect(productionEnv).toContain('APP_URL=https://acme.com  # REQUIRED: Set in deployment');
    expect(productionEnv).not.toContain('VITE_API_URL=https://acme.com');
    expect(productionEnv).toContain('# VITE_API_URL=https://api.acme.com');
    expect(productionEnv).toContain(
      'GOOGLE_CALLBACK_URL=https://acme.com/api/auth/oauth/google/callback',
    );
    expect(productionEnv).toContain('POSTGRES_DB=acme_cloud_prod');
    expect(productionEnv).toContain('EMAIL_FROM_ADDRESS=no-reply@acme.com');
    expect(productionEnv).toContain('EMAIL_REPLY_TO=support@acme.com');
    expect(productionEnv).toContain('SMTP_HOST=smtp.mail.acme.com');

    const setup = readFixture(root, 'main/tools/scripts/dev/setup.ts');
    expect(setup).toContain('postgresDb: "acme_cloud_dev"');
    expect(setup).toContain('viteAppName: "Acme Cloud"');
    expect(setup).toContain('emailFromName: "Acme Cloud"');
    expect(setup).toContain('emailFromAddress: "no-reply@acme.com"');
    expect(setup).toContain('JWT_ISSUER=acme-cloud');
    expect(setup).toContain('JWT_AUDIENCE=acme-cloud-api');

    const prodCompose = readFixture(root, 'infra/docker/production/docker-compose.prod.yml');
    expect(prodCompose).toContain('name: acme-cloud-prod');
    expect(prodCompose).toContain('container_name: acme-cloud-api');
    expect(prodCompose).toContain('volume: acme-cloud-postgres-data');
    expect(prodCompose).toContain('database: acme_cloud_prod acme_cloud_dev acme_cloud_test');
    expect(prodCompose).toContain('compose_fallbacks: "${EMAIL_FROM_NAME:-Acme Cloud}"');
    expect(prodCompose).toContain('"${VITE_APP_NAME:-Acme Cloud}"');
    expect(prodCompose).toContain('domains: https://acme.com https://acme.com');

    const terraformExample = readFixture(root, 'infra/cloud/terraform.tfvars.example');
    expect(terraformExample).toContain('tfvars: app_name = "acme-cloud"');
    expect(terraformExample).toContain('domains: https://acme.com https://acme.com');

    const gcpGuide = readFixture(root, 'docs/deploy/providers/gcp.md');
    expect(gcpGuide).toContain('gcp: acme-cloud-vm acme-cloud-zone');
    expect(gcpGuide).toContain('acme-cloud-backups');
    expect(gcpGuide).toContain('repo: your-org/acme-cloud');

    const githubSetup = readFixture(root, 'infra/setup-github.sh');
    expect(githubSetup).toContain('setup: Acme Cloud GitHub Repository Setup Acme Cloud IaC');
    expect(githubSetup).toContain('repo: your-org/acme-cloud');
    expect(githubSetup).toContain('ssh: deploy@acme.com');

    const caddyfile = readFixture(root, 'infra/runtime/caddy/Caddyfile');
    expect(caddyfile).toContain('Production Caddy Configuration for Acme Cloud');

    const devCaddyfile = readFixture(root, 'infra/runtime/caddy/Caddyfile.dev');
    expect(devCaddyfile).toContain('Development Caddy Configuration for Acme Cloud');

    const alerts = readFixture(root, 'infra/runtime/prometheus/alerts.yml');
    expect(alerts).toContain(
      'prometheus: acme-cloud-api acme-cloud-availability acme-cloud-http acme-cloud-database acme-cloud-auth Acme Cloud API acme-cloud API',
    );

    const dockerfileWeb = readFixture(root, 'infra/docker/Dockerfile.web');
    expect(dockerfileWeb).toContain('vite_arg: ARG VITE_APP_NAME="Acme Cloud"');

    const readme = readFixture(root, 'README.md');
    expect(readme).toContain('# Acme Cloud');
    expect(readme).toContain('## Why Acme Cloud');
    expect(readme).toContain('Acme Cloud started as a clone-and-own SaaS starter');
    expect(readme).toContain('git clone https://github.com/acme/acme-cloud.git');
    expect(readme).toContain('cd acme-cloud');
    expect(readme).toContain('Acme Cloud ships a production-safe **starter path**');
    expect(readme).toContain('MIT © 2026 Acme Cloud Contributors');
    expect(readme).toContain('Built from a clone-and-own SaaS starter.');
  });

  it('renders quoted app names safely in generated code and deploy defaults', () => {
    const appName = `Founder's "CRM"`;
    const root = createFixtureRepo();
    const plan = createStarterRenamePlan({
      appName,
      apply: true,
      slug: 'founders-crm',
    });

    applyStarterRenamePlan(plan, root);

    const setup = readFixture(root, 'main/tools/scripts/dev/setup.ts');
    expect(setup).toContain(`viteAppName: ${JSON.stringify(appName)}`);
    expect(setup).toContain(`emailFromName: ${JSON.stringify(appName)}`);

    const prodCompose = readFixture(root, 'infra/docker/production/docker-compose.prod.yml');
    expect(prodCompose).toContain(`"\${EMAIL_FROM_NAME:-Founder's \\"CRM\\"}"`);
    expect(prodCompose).toContain(`"\${VITE_APP_NAME:-Founder's \\"CRM\\"}"`);

    const dockerfileWeb = readFixture(root, 'infra/docker/Dockerfile.web');
    expect(dockerfileWeb).toContain('vite_arg: ARG VITE_APP_NAME="Founder\'s \\"CRM\\""');
  });

  it('refuses to patch a fixture with missing anchors', () => {
    const root = createFixtureRepo();
    writeFixture(root, 'config/env/.env.production.example', 'APP_NAME=Your App\n');

    expect(() =>
      applyStarterRenamePlan(
        createStarterRenamePlan({ appName: 'Acme Cloud', apply: true, domain: 'acme.com' }),
        root,
      ),
    ).toThrow('missing env key');
  });
});
