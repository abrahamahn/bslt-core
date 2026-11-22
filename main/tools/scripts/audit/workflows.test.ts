// main/tools/scripts/audit/workflows.test.ts
/**
 * What the two workflows are, pinned (restructure plan, section 14.5).
 *
 * `ci.yml` is the one CI workflow. Its shape is a set of decisions that a later
 * edit can undo without anything turning red: which lanes run on a pull
 * request and which only at night, that the image build waits for both gates,
 * that the real-DB job runs on the role split, that a scanner that blocks
 * keeps blocking. Each is asserted here against the file's text.
 *
 * The one piece of logic in it, the changed-paths filter that decides whether
 * the Terraform validation runs, is executed for real in a scratch git
 * repository under the shell options GitHub uses.
 *
 * `deploy.yml` is the one deploy workflow. What a run does is decided by its
 * `plan` job, a shell step, so that the decision can be run here for every
 * event instead of being spread over `if:` expressions nobody executes: which
 * event deploys which environment, that nothing deploys from a CI run that was
 * not a passing push to main, that a rollback needs a full commit SHA, that
 * Terraform never runs unless asked for, and that `apply` is refused without a
 * remote state backend. The remote script of its `app` job has its own
 * simulation in `deploy-workflow-database-roles.test.ts`.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { TOMBSTONED_PATHS } from '../../gates/tombstones';
import { PATHS, repoPath } from '../../lib/paths';
import {
  blockOf,
  jobKey,
  jobOf,
  jobsOf,
  needsOf,
  readWorkflow,
  stepOf,
} from '../../lib/workflow-file';

const CI = readWorkflow('ci.yml');
const DEPLOY = readWorkflow('deploy.yml');
const VERSIONS = readFileSync(repoPath('infra/versions.env'), 'utf8');
const POSTGRES_IMAGE = /^POSTGRES_IMAGE=(.+)$/mu.exec(VERSIONS)?.[1] ?? '';

const HEAVY_LANE = "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'";

/** The `on:` block of a workflow: everything up to the next top-level key. */
function triggersOf(workflow: string): string {
  const lines = workflow.split('\n');
  const start = lines.indexOf('on:');
  if (start === -1) throw new Error('the workflow has no `on:` block');
  const end = lines.findIndex((line, index) => index > start && /^[^\s#]/u.test(line));
  return lines.slice(start + 1, end === -1 ? lines.length : end).join('\n');
}

/** The top-level keys of a block indented by `indent` spaces. */
function keysAt(block: string, indent: number): string[] {
  const pattern = new RegExp(`^ {${String(indent)}}([a-z_]+):`, 'u');
  return block.split('\n').flatMap((line) => pattern.exec(line)?.[1] ?? []);
}

/** A workflow text without its comment lines. */
function withoutComments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

/** The value of a key of a workflow's top-level `concurrency:` block. */
function runConcurrency(workflow: string, key: 'group' | 'cancel-in-progress'): string {
  const block = /^concurrency:\n((?: {2}.+\n)+)/mu.exec(workflow)?.[1] ?? '';
  const value = new RegExp(`^ {2}${key}: (.+)$`, 'mu').exec(block)?.[1];
  if (value === undefined) throw new Error(`the workflow has no run-level concurrency ${key}`);
  return value;
}

/**
 * Evaluates the `${{ }}` expressions of a concurrency group for one event, the
 * way GitHub does for the operators these groups use: `==`, `!=`, `&&`, `||`
 * and parentheses over string literals and context values. `&&` and `||`
 * return an operand, and an empty or unknown value is false.
 */
function evaluateGroup(text: string, context: Readonly<Record<string, string>>): string {
  return text.replace(/\$\{\{\s*(.+?)\s*\}\}/gu, (_whole, expression: string) => {
    const tokens = expression.match(/'[^']*'|==|!=|&&|\|\||[()]|[A-Za-z_][\w.-]*/gu) ?? [];
    if (tokens.join('') !== expression.replace(/\s+/gu, '')) {
      throw new Error(`cannot evaluate \${{ ${expression} }}`);
    }
    let position = 0;
    const primary = (): string => {
      const token = tokens[position++] ?? '';
      if (token === '(') {
        const value = or();
        position += 1;
        return value;
      }
      return token.startsWith("'") ? token.slice(1, -1) : (context[token] ?? '');
    };
    const equality = (): string => {
      const left = primary();
      const operator = tokens[position];
      if (operator !== '==' && operator !== '!=') return left;
      position += 1;
      return (left === primary()) === (operator === '==') ? 'true' : '';
    };
    const and = (): string => {
      let value = equality();
      while (tokens[position] === '&&') {
        position += 1;
        const right = equality();
        if (value !== '') value = right;
      }
      return value;
    };
    const or = (): string => {
      let value = and();
      while (tokens[position] === '||') {
        position += 1;
        const right = and();
        if (value === '') value = right;
      }
      return value;
    };
    return or();
  });
}

/** The workflows Phase 4 folded into ci.yml and deploy.yml (plan section 14.5). */
const FOLDED_IN_PHASE_4 = [
  'continuous-integration.yml',
  'security-scanning.yml',
  'dependency-audit.yml',
  'application-deploy.yml',
  'staging-deploy.yml',
  'demo-deploy.yml',
  'deployment-rollback.yml',
  'infrastructure-deploy.yml',
  'infrastructure-destroy.yml',
  'infrastructure-test.yml',
  'web-deploy-cloudflare.yml',
] as const;

describe('workflows: one CI, one deploy', () => {
  it('holds ci.yml and deploy.yml, and nothing else', () => {
    expect(readdirSync(PATHS.workflows).toSorted()).toEqual(['ci.yml', 'deploy.yml']);
  });

  it('deletes and tombstones database-backup.yml in Phase 20 (D13) and ships alerts.yml in deploy.yml', () => {
    const tombstone = TOMBSTONED_PATHS.find(
      (entry) => entry.path === '.github/workflows/database-backup.yml',
    );
    expect(tombstone?.phase).toBe(20);
    expect(tombstone?.note).toMatch(/infra\/runtime\/backup/u);

    expect(DEPLOY).toContain('fetch_repo_file "infra/runtime/prometheus/alerts.yml"');
    const alertsText = readFileSync(repoPath('infra/runtime/prometheus/alerts.yml'), 'utf8');
    expect(alertsText).toContain('alert: EventLoopLagHigh');
    expect(alertsText).toContain('alert: DeadBackgroundJobs');
    expect(alertsText).toContain('alert: BackupStale');
  });

  it.each(FOLDED_IN_PHASE_4)('%s is deleted and tombstoned', (name) => {
    const tombstone = TOMBSTONED_PATHS.find((entry) => entry.path === `.github/workflows/${name}`);

    expect(tombstone?.phase).toBe(4);
    // The note says where the work went.
    expect(tombstone?.note).toMatch(/ci\.yml|deploy\.yml/u);
  });

  it('names every secret and variable deploy.yml reads in its header', () => {
    // The header is the list an operator configures from. `GITHUB_TOKEN` is
    // provided by GitHub.
    const header = DEPLOY.slice(0, DEPLOY.indexOf('\non:\n'));
    const read = new Set(
      [...withoutComments(DEPLOY).matchAll(/\b(?:secrets|vars)\.([A-Z][A-Z0-9_]*)/gu)].map(
        (match) => match[1] ?? '',
      ),
    );
    read.delete('GITHUB_TOKEN');

    expect(read.size).toBeGreaterThan(20);
    for (const name of read) expect(header, name).toMatch(new RegExp(`\\b${name}\\b`, 'u'));
  });
});

describe('workflows: every `needs` names a job of the same file', () => {
  const files = readdirSync(PATHS.workflows).filter((name) => /\.ya?ml$/u.test(name));

  it.each(files)('%s', (name) => {
    const jobs = jobsOf(readWorkflow(name));

    expect(jobs.size).toBeGreaterThan(0);
    for (const [id, job] of jobs) {
      for (const needed of needsOf(job)) expect([...jobs.keys()], `${id} needs`).toContain(needed);
    }
  });
});

describe('ci.yml: triggers and lanes', () => {
  it('runs on pull requests, pushes to main, a nightly schedule and manually', () => {
    const triggers = triggersOf(CI);

    expect(keysAt(triggers, 2)).toEqual(['pull_request', 'push', 'schedule', 'workflow_dispatch']);
    expect(triggers).toContain('    branches: [main]');
    expect(triggers).toMatch(/^ {4}- cron: '\d+ \d+ \* \* \*'$/mu);
  });

  it('runs the gates and the scanners on every event', () => {
    for (const id of [
      'static',
      'real-db',
      'security-codeql',
      'security-semgrep',
      'security-dependencies',
      'security-secrets',
      'security-trivy',
    ]) {
      expect(jobKey(jobOf(CI, id), 'if'), id).toBeUndefined();
    }
  });

  it('keeps e2e and the heavy checks to the nightly schedule and manual runs', () => {
    for (const id of ['e2e', 'build', 'coverage', 'lighthouse']) {
      expect(jobKey(jobOf(CI, id), 'if'), id).toBe(HEAVY_LANE);
    }
  });

  it('writes the development env before the e2e servers start', () => {
    // The API refuses to boot without its secrets (JWT_SECRET and the rest), and
    // a fresh checkout has no env file: Playwright's webServer then never starts.
    const e2e = jobOf(CI, 'e2e');
    const writesEnv = e2e.indexOf(
      'run: pnpm bootstrap --preset docker --yes --skip-db --skip-docker --skip-install',
    );

    expect(writesEnv).toBeGreaterThan(-1);
    expect(writesEnv).toBeLessThan(e2e.indexOf('run: pnpm db:migrate'));
    expect(writesEnv).toBeLessThan(e2e.indexOf('run: pnpm test:e2e'));
  });

  it('runs the optional-surface e2e leg after the starter leg, with the toggles its specs read', () => {
    // A toggle both un-skips the specs and makes globalSetup turn the runtime flag
    // on; without this leg the flag-gated specs run nowhere.
    const e2e = jobOf(CI, 'e2e');
    const starter = e2e.indexOf('run: pnpm test:e2e\n');
    const optional = e2e.indexOf(
      'run: pnpm test:e2e billing/ admin/ auth/auth.e2e.ts system/runtime-flags.e2e.ts',
    );

    expect(starter).toBeGreaterThan(-1);
    expect(optional).toBeGreaterThan(starter);
    for (const toggle of [
      'E2E_ENABLE_ADVANCED_ADMIN',
      'E2E_ENABLE_BILLING',
      'E2E_ENABLE_ACTIVITY_FEED',
    ]) {
      expect(e2e, toggle).toContain(`${toggle}: '1'`);
    }
    // Where config/playwright.config.ts writes its results on CI.
    expect(e2e).toContain('tests/e2e/reports/test-results/');
    expect(e2e).not.toContain('path: playwright-report/');
  });

  it('builds the images on a push to main only, after both gates', () => {
    const images = jobOf(CI, 'images');

    expect(jobKey(images, 'if')).toBe(
      "github.event_name == 'push' && github.ref == 'refs/heads/main'",
    );
    expect(needsOf(images).toSorted()).toEqual(['real-db', 'static']);
    // What deploy.yml downloads from the run it was started by.
    expect(images).toContain('name: deployment-images');
    expect(images).toContain('file: ./infra/docker/Dockerfile\n');
    expect(images).toContain('file: ./infra/docker/Dockerfile.web\n');
  });

  it('has exactly the jobs the lanes are documented with', () => {
    expect([...jobsOf(CI).keys()].toSorted()).toEqual(
      [
        'build',
        'changes',
        'coverage',
        'e2e',
        'images',
        'infra',
        'lighthouse',
        'real-db',
        'security',
        'security-codeql',
        'security-dependencies',
        'security-secrets',
        'security-semgrep',
        'security-trivy',
        'static',
      ].toSorted(),
    );
  });
});

describe('ci.yml: runs that wait for one another', () => {
  const MAIN = 'refs/heads/main';
  const group = (event: string, ref: string): string =>
    evaluateGroup(runConcurrency(CI, 'group'), { 'github.event_name': event, 'github.ref': ref });
  const cancels = (ref: string): boolean =>
    evaluateGroup(runConcurrency(CI, 'cancel-in-progress'), { 'github.ref': ref }) === 'true';

  it('runs the pushes to main one after the other, and cancels none that started', () => {
    // The deploy of main starts from these runs, in the order they finish.
    expect(group('push', MAIN)).toBe(group('push', MAIN));
    expect(cancels(MAIN)).toBe(false);
  });

  it.each(['schedule', 'workflow_dispatch'])(
    'keeps a %s run on main out of the queue of the pushes',
    (event) => {
      // A group holds one waiting run: a newer one cancels it. In one group
      // the nightly run would cancel the waiting run of the newest push, whose
      // commit then gets no images and no deploy, or the push would cancel
      // that night's heavy lane.
      expect(group(event, MAIN)).not.toBe(group('push', MAIN));
    },
  );

  it('still replaces a superseded run of the same pull request', () => {
    const pullRequest = 'refs/pull/7/merge';

    expect(group('pull_request', pullRequest)).toBe(group('pull_request', pullRequest));
    expect(group('pull_request', pullRequest)).not.toBe(group('pull_request', 'refs/pull/8/merge'));
    expect(cancels(pullRequest)).toBe(true);
  });
});

describe('ci.yml: static', () => {
  it('runs the gate self-test and the merge gate', () => {
    const job = jobOf(CI, 'static');

    expect(job).toContain('run: pnpm bslt gate --self-test');
    expect(job).toContain('run: pnpm bslt gate merge');
  });

  it('runs the unit tests once: in the merge gate, and nowhere else', () => {
    // The merge lane's `test` gate is `turbo run test` over every package. A
    // `unit` job, a second merge lane (`gate nightly` is the merge lane plus
    // the build) or a bare `pnpm test` would run the same tests again.
    const runs = [...CI.matchAll(/^\s+run: (.+)$/gmu)].map((match) => match[1] ?? '');

    expect(runs.filter((command) => command === 'pnpm bslt gate merge')).toHaveLength(1);
    expect(runs.filter((command) => /\bgate nightly\b/u.test(command))).toEqual([]);
    expect(runs.filter((command) => /^pnpm (?:run )?test$|turbo run test/u.test(command))).toEqual(
      [],
    );
    expect([...jobsOf(CI).keys()]).not.toContain('unit');
  });
});

describe('ci.yml: real-db', () => {
  const job = jobOf(CI, 'real-db');
  const env = new Map(
    [...job.matchAll(/^ {6}([A-Z_]+): (postgresql:\S+)$/gmu)].map((match) => [
      match[1] ?? '',
      new URL(match[2] ?? ''),
    ]),
  );

  it('runs the pinned Postgres image as its service', () => {
    expect(POSTGRES_IMAGE).not.toBe('');
    expect(job).toContain(`        image: ${POSTGRES_IMAGE}\n`);
  });

  it('connects each role as itself', () => {
    expect(env.get('DATABASE_URL')?.username).toBe('bslt_app');
    expect(env.get('WORKER_DATABASE_URL')?.username).toBe('bslt_worker');
    expect(env.get('MIGRATION_DATABASE_URL')?.username).toBe('bslt_owner');
  });

  it('uses the superuser as the admin connection only', () => {
    const superuser = [...env].filter(([, url]) => url.username === 'postgres').map(([key]) => key);

    // The smoke suite's own URL is the accepted Phase 0 residual.
    expect(superuser.toSorted()).toEqual(['DATABASE_ADMIN_URL', 'POSTGRES_SMOKE_DATABASE_URL']);
    // No POSTGRES_USER / POSTGRES_PASSWORD pair for a tool to fall back to.
    expect(job).not.toMatch(/^ {6}POSTGRES_(?:USER|PASSWORD):/mu);
  });

  it('bootstraps the roles, migrates, then tests, in the order of a deploy', () => {
    const order = [
      'run: pnpm db:bootstrap:roles',
      'run: pnpm db:migrate',
      'run: pnpm db:audit --db',
      'run: pnpm bslt db catalog --check',
      'run: pnpm test:real-db',
      'run: pnpm test:postgres-smoke',
    ].map((command) => job.indexOf(command));

    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
  });
});

describe('ci.yml: security', () => {
  it.each([
    ['security-semgrep', 'Run Semgrep'],
    ['security-dependencies', 'pnpm audit'],
    ['security-dependencies', 'pnpm audit (production dependencies)'],
    ['security-dependencies', 'OSV Scanner'],
    ['security-secrets', 'Run Gitleaks'],
  ])('%s: "%s" fails its job on a finding', (id, name) => {
    expect(stepOf(jobOf(CI, id), name)).not.toContain('continue-on-error');
  });

  it('audits every dependency on each run and the production set nightly', () => {
    const job = jobOf(CI, 'security-dependencies');

    expect(stepOf(job, 'pnpm audit')).toContain('run: pnpm audit --audit-level moderate');
    expect(stepOf(job, 'pnpm audit')).not.toContain('if:');
    const production = stepOf(job, 'pnpm audit (production dependencies)');
    expect(production).toContain('run: pnpm audit --prod');
    expect(production).toContain(`if: ${HEAVY_LANE}`);
  });

  it('gives one verdict that is red when any scanner job is', () => {
    const verdict = jobOf(CI, 'security');
    const scanners = [...jobsOf(CI).keys()].filter((id) => id.startsWith('security-'));

    expect(scanners).toHaveLength(5);
    expect(needsOf(verdict).toSorted()).toEqual(scanners.toSorted());
    // `always()`: without it a failed scanner would skip the verdict, and a
    // skipped required check counts as passed.
    expect(jobKey(verdict, 'if')).toBe('always()');
  });

  it.each([
    [['success', 'success'], 0],
    [['success', 'failure'], 1],
    [['success', 'cancelled'], 1],
    [['skipped', 'success'], 1],
  ])('the verdict for %j exits %i', (results, status) => {
    const script = blockOf(stepOf(jobOf(CI, 'security'), 'Scanner results'), 'run');

    const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
      env: { PATH: process.env['PATH'] ?? '', RESULTS: results.join(' ') },
      encoding: 'utf8',
    });

    expect(result.status).toBe(status);
  });
});

describe('ci.yml: the infra lane', () => {
  const script = blockOf(stepOf(jobOf(CI, 'changes'), 'Detect infrastructure changes'), 'run');
  const scratch: string[] = [];

  afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A repository with four commits: a base, a docs change, a look-alike, an infra change. */
  function repository(): {
    dir: string;
    base: string;
    docs: string;
    lookalike: string;
    infra: string;
  } {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bslt-ci-changes-'));
    scratch.push(dir);
    const git = (...args: string[]): string =>
      execFileSync('git', ['-c', 'user.name=ci', '-c', 'user.email=ci@example.test', ...args], {
        cwd: dir,
        encoding: 'utf8',
        env: { PATH: process.env['PATH'] ?? '', HOME: dir, GIT_CONFIG_NOSYSTEM: '1' },
      }).trim();
    const commit = (file: string, content: string): string => {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), content);
      git('add', '-A');
      git('commit', '-q', '--no-gpg-sign', '-m', file);
      return git('rev-parse', 'HEAD');
    };
    git('init', '-q');
    const base = commit('infra/cloud/main.tf', 'a\n');
    const docs = commit('docs/readme.md', 'b\n');
    // Not under infra/, though its name starts the same way.
    const lookalike = commit('infrastructure-notes.md', 'c\n');
    const infra = commit('infra/cloud/main.tf', 'd\n');
    return { dir, base, docs, lookalike, infra };
  }

  /** Runs the step at `head` and returns the `infra` output it wrote. */
  function detect(dir: string, head: string, env: Readonly<Record<string, string>>): string {
    execFileSync('git', ['checkout', '-q', '--detach', head], { cwd: dir });
    const output = path.join(dir, '.github-output');
    writeFileSync(output, '');
    // The shell GitHub runs a `run:` step with.
    const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
      cwd: dir,
      env: { PATH: process.env['PATH'] ?? '', HOME: dir, GITHUB_OUTPUT: output, ...env },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    return readFileSync(output, 'utf8').trim();
  }

  it('skips the lane when nothing under infra/ changed', () => {
    const { dir, base, docs } = repository();

    expect(detect(dir, docs, { EVENT_NAME: 'pull_request', BASE_SHA: base })).toBe('infra=false');
  });

  it('skips the lane for a file that only starts with "infra"', () => {
    const { dir, docs, lookalike } = repository();

    expect(detect(dir, lookalike, { EVENT_NAME: 'push', BASE_SHA: docs })).toBe('infra=false');
  });

  it('runs the lane when a file under infra/ changed', () => {
    const { dir, lookalike, infra } = repository();

    expect(detect(dir, infra, { EVENT_NAME: 'push', BASE_SHA: lookalike })).toBe('infra=true');
    expect(detect(dir, infra, { EVENT_NAME: 'pull_request', BASE_SHA: lookalike })).toBe(
      'infra=true',
    );
  });

  it.each(['schedule', 'workflow_dispatch'])('runs the lane on %s whatever changed', (event) => {
    const { dir, base, docs } = repository();

    expect(detect(dir, docs, { EVENT_NAME: event, BASE_SHA: base })).toBe('infra=true');
  });

  it.each([
    ['a base that is not in the repository', '0123456789abcdef0123456789abcdef01234567'],
    ['the all-zero base of a new branch', '0000000000000000000000000000000000000000'],
    ['no base at all', ''],
  ])('runs the lane rather than skip it with %s', (_label, base) => {
    const { dir, docs } = repository();

    expect(detect(dir, docs, { EVENT_NAME: 'push', BASE_SHA: base })).toBe('infra=true');
  });

  it('validates the Terraform of both providers without a backend or credentials', () => {
    const job = jobOf(CI, 'infra');

    expect(needsOf(job)).toEqual(['changes']);
    expect(jobKey(job, 'if')).toBe("needs.changes.outputs.infra == 'true'");
    expect(job).toContain('provider: [digitalocean, gcp]');
    expect(job).toContain('terraform init -backend=false');
    expect(job).toContain('terraform validate');
    expect(job).not.toMatch(/terraform (?:plan|apply|destroy)/u);
    expect(job).not.toContain('secrets.');
  });
});

/** Runs a `run:` block the way GitHub does and returns its status and `$GITHUB_OUTPUT`. */
function runStep(
  script: string,
  env: Readonly<Record<string, string>>,
  cwd?: string,
): { status: number | null; outputs: Record<string, string>; log: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bslt-workflow-step-'));
  try {
    const output = path.join(dir, 'github-output');
    writeFileSync(output, '');
    const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
      cwd: cwd ?? dir,
      env: { PATH: process.env['PATH'] ?? '', HOME: dir, GITHUB_OUTPUT: output, ...env },
      encoding: 'utf8',
    });
    const outputs: Record<string, string> = {};
    for (const line of readFileSync(output, 'utf8').split('\n')) {
      const separator = line.indexOf('=');
      if (separator > 0) outputs[line.slice(0, separator)] = line.slice(separator + 1);
    }
    return { status: result.status, outputs, log: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('deploy.yml: triggers', () => {
  it('starts from a finished CI run on main, a push to staging, or manually', () => {
    const triggers = triggersOf(DEPLOY);

    expect(keysAt(triggers, 2)).toEqual(['workflow_run', 'push', 'workflow_dispatch']);
    expect(triggers).toContain("    workflows: ['CI']");
    expect(triggers).toContain('    types: [completed]');
    expect(triggers).toContain('    branches: [main]');
    expect(triggers).toContain('    branches: [staging]');
    // The workflow it waits for is ci.yml, by its name.
    expect(CI.split('\n')[0]).toBe('name: CI');
    expect(triggers).not.toContain('pull_request');
  });

  it('offers a rollback SHA and a Terraform action as manual inputs', () => {
    const triggers = triggersOf(DEPLOY);

    expect(keysAt(triggers, 6)).toEqual(['environment', 'rollback_sha', 'terraform', 'provider']);
    for (const option of ['staging', 'production', 'demo', 'none', 'plan', 'apply']) {
      expect(triggers).toContain(`          - ${option}\n`);
    }
    // A manual run without choices deploys staging and runs no Terraform.
    expect(triggers).toMatch(/environment:[\s\S]*?default: staging/u);
    expect(triggers).toMatch(/terraform:[\s\S]*?default: none/u);
  });

  it('uses the three GitHub environments', () => {
    expect(jobKey(jobOf(DEPLOY, 'app'), 'environment')).toBe(
      '${{ needs.plan.outputs.environment }}',
    );
    expect(jobKey(jobOf(DEPLOY, 'demo'), 'environment')).toBe('demo');
    expect(jobKey(jobOf(DEPLOY, 'terraform'), 'environment')).toBe(
      '${{ needs.plan.outputs.environment }}',
    );
  });

  it('runs each target only when the plan says so', () => {
    expect(jobKey(jobOf(DEPLOY, 'staging-images'), 'if')).toBe(
      "needs.plan.outputs.build == 'true'",
    );
    expect(jobKey(jobOf(DEPLOY, 'app'), 'if')).toContain("needs.plan.outputs.app == 'true'");
    expect(jobKey(jobOf(DEPLOY, 'demo-images'), 'if')).toContain(
      "needs.plan.outputs.demo == 'true'",
    );
    expect(jobKey(jobOf(DEPLOY, 'demo'), 'if')).toContain("needs.plan.outputs.demo == 'true'");
    expect(jobKey(jobOf(DEPLOY, 'terraform'), 'if')).toBe("needs.plan.outputs.terraform == 'true'");
    expect([...jobsOf(DEPLOY).keys()]).toEqual([
      'plan',
      'staging-images',
      'app',
      'demo-images',
      'demo',
      'terraform',
    ]);
  });

  it('never deploys an environment twice at once', () => {
    for (const id of ['app', 'demo', 'terraform']) {
      const job = jobOf(DEPLOY, id);
      expect(job, id).toMatch(/^ {4}concurrency:\n {6}group: .+\n {6}cancel-in-progress: false$/mu);
    }
  });

  describe('the order of whole runs', () => {
    // A staging run builds its images before it deploys them. With a group on
    // the `app` job alone, two pushes build side by side and the older commit
    // can finish its build last, then deploy over the newer one, in a green run.
    const group = (context: Readonly<Record<string, string>>): string =>
      evaluateGroup(runConcurrency(DEPLOY, 'group'), context);
    const push = (runId: string): Record<string, string> => ({
      'github.event_name': 'push',
      'github.run_id': runId,
    });
    const manual = (environment: string, runId: string): Record<string, string> => ({
      'github.event_name': 'workflow_dispatch',
      'inputs.environment': environment,
      'github.run_id': runId,
    });
    const afterCi = (runId: string): Record<string, string> => ({
      'github.event_name': 'workflow_run',
      'github.run_id': runId,
    });

    it('runs two pushes to staging one after the other, and never cancels a deploy', () => {
      expect(group(push('101'))).toBe(group(push('102')));
      expect(runConcurrency(DEPLOY, 'cancel-in-progress')).toBe('false');
    });

    it('puts a manual staging run in the same queue', () => {
      expect(group(manual('staging', '103'))).toBe(group(push('101')));
    });

    it('queues no other run behind another', () => {
      // A pending run is cancelled when a newer one queues in its group. Every
      // finished CI run on main starts a run here, most of which deploy
      // nothing: in one group they would cancel a production deploy that waits.
      const others = [
        group(afterCi('201')),
        group(afterCi('202')),
        group(manual('production', '203')),
        group(manual('demo', '204')),
      ];

      expect(new Set(others).size).toBe(others.length);
      expect(others).not.toContain(group(push('101')));
    });

    it('uses a name no job-level group has, so a run never waits for itself', () => {
      const runGroups = [push('1'), manual('staging', '2'), afterCi('3')].map((event) =>
        group(event),
      );
      const jobGroups = ['staging', 'production', 'demo'].flatMap((environment) =>
        [...jobsOf(DEPLOY).values()].flatMap((job) => {
          const value = /^ {6}group: (.+)$/mu.exec(job)?.[1];
          return value === undefined
            ? []
            : [evaluateGroup(value, { 'needs.plan.outputs.environment': environment })];
        }),
      );

      expect(jobGroups.length).toBeGreaterThan(0);
      for (const name of runGroups) expect(jobGroups).not.toContain(name);
    });
  });
});

describe('deploy.yml: what a run does (the plan job)', () => {
  const script = blockOf(stepOf(jobOf(DEPLOY, 'plan'), 'Decide'), 'run');
  const HEAD = '0123456789abcdef0123456789abcdef01234567';
  const OLDER = 'fedcba9876543210fedcba9876543210fedcba98';
  const NOTHING = {
    mode: 'none',
    app: 'false',
    build: 'false',
    demo: 'false',
    terraform: 'false',
  };

  const stubDirs: string[] = [];

  afterEach(() => {
    for (const dir of stubDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * The environment of a runner whose `gh` answers from fixtures: the tip of
   * main is `mainTip`, or the call fails when it is undefined. Every call is
   * logged, so a test can tell that the API was not asked at all.
   */
  function github(
    mainTip: string | undefined,
    passedCiRuns?: string,
  ): {
    env: Record<string, string>;
    calls: () => string[];
  } {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bslt-plan-gh-'));
    stubDirs.push(dir);
    const log = path.join(dir, 'gh.log');
    writeFileSync(log, '');
    writeFileSync(
      path.join(dir, 'gh'),
      [
        '#!/bin/sh',
        'printf "%s\\n" "$*" >> "$STUB_GH_LOG"',
        '[ -n "$GH_TOKEN" ] || exit 4',
        'case "$1 $2" in',
        '  "api repos/acme/app/commits/main")',
        '    [ -n "${STUB_MAIN_TIP:-}" ] || exit 1',
        '    printf "%s\\n" "$STUB_MAIN_TIP" ;;',
        // The number of CI runs GitHub lists for a query, which is logged above.
        '  "api repos/acme/app/actions/workflows/ci.yml/runs?"*)',
        '    [ -n "${STUB_PASSED_CI_RUNS:-}" ] || exit 1',
        '    printf "%s\\n" "$STUB_PASSED_CI_RUNS" ;;',
        '  *) exit 9 ;;',
        'esac',
        '',
      ].join('\n'),
    );
    chmodSync(path.join(dir, 'gh'), 0o755);
    return {
      env: {
        PATH: `${dir}:${process.env['PATH'] ?? ''}`,
        GITHUB_REPOSITORY: 'acme/app',
        GH_TOKEN: 'fixture-github-token',
        STUB_GH_LOG: log,
        ...(mainTip === undefined ? {} : { STUB_MAIN_TIP: mainTip }),
        ...(passedCiRuns === undefined ? {} : { STUB_PASSED_CI_RUNS: passedCiRuns }),
      },
      calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean),
    };
  }

  /** A `workflow_run` event as deploy.yml sees it; the CI run's facts are overridable. */
  function ciRun(overrides: Readonly<Record<string, string>> = {}): Record<string, string> {
    return {
      EVENT_NAME: 'workflow_run',
      // For workflow_run GitHub sets these to the default branch, not the run's.
      REF_NAME: 'main',
      COMMIT_SHA: 'ffffffffffffffffffffffffffffffffffffffff',
      RUN_CONCLUSION: 'success',
      RUN_EVENT: 'push',
      RUN_HEAD_BRANCH: 'main',
      RUN_HEAD_SHA: HEAD,
      RUN_ATTEMPT: '1',
      ...overrides,
    };
  }

  function manual(inputs: Readonly<Record<string, string>>, ref = 'main'): Record<string, string> {
    return {
      EVENT_NAME: 'workflow_dispatch',
      REF: `refs/heads/${ref}`,
      REF_NAME: ref,
      COMMIT_SHA: HEAD,
      INPUT_ENVIRONMENT: 'staging',
      INPUT_ROLLBACK_SHA: '',
      INPUT_TERRAFORM: 'none',
      ...inputs,
    };
  }

  it('deploys production and the demo after CI passed for a push to main', () => {
    const { status, outputs } = runStep(script, ciRun());

    expect(status).toBe(0);
    expect(outputs).toEqual({
      environment: 'production',
      mode: 'deploy',
      // The commit CI ran on, not the default branch's head at this moment.
      sha: HEAD,
      app: 'true',
      build: 'false',
      demo: 'true',
      terraform: 'false',
    });
  });

  it.each([
    ['failed', { RUN_CONCLUSION: 'failure' }],
    ['was cancelled', { RUN_CONCLUSION: 'cancelled' }],
    ['was the nightly run', { RUN_EVENT: 'schedule' }],
    ['was started by hand', { RUN_EVENT: 'workflow_dispatch' }],
    ['ran for a pull request', { RUN_EVENT: 'pull_request', RUN_HEAD_BRANCH: 'feature' }],
    ['ran on another branch', { RUN_HEAD_BRANCH: 'staging' }],
  ])('deploys nothing when the CI run %s', (_label, overrides) => {
    const { status, outputs } = runStep(script, ciRun(overrides));

    expect(status).toBe(0);
    expect(outputs).toMatchObject(NOTHING);
  });

  describe('a CI run that was run again', () => {
    // "Re-run jobs" on an earlier run of main ends in `workflow_run: completed`
    // once more, for that run's own, older commit, while its image artifact
    // still exists. Deployed as it stands, it would put production, the demo
    // and the web app back on that commit, as an ordinary deploy.
    const PRODUCTION = { environment: 'production', mode: 'deploy', sha: HEAD, app: 'true' };

    it('reads the attempt and the tip of main with the workflow token', () => {
      const step = stepOf(jobOf(DEPLOY, 'plan'), 'Decide');

      expect(step).toContain('RUN_ATTEMPT: ${{ github.event.workflow_run.run_attempt }}');
      expect(step).toContain('GH_TOKEN: ${{ github.token }}');
    });

    it('deploys nothing when main has moved on since', () => {
      const api = github(OLDER);

      const result = runStep(script, { ...ciRun({ RUN_ATTEMPT: '2' }), ...api.env });

      expect(result.status).toBe(0);
      expect(result.outputs).toMatchObject(NOTHING);
      expect(result.log).toContain('rollback_sha');
      expect(api.calls()).toEqual(['api repos/acme/app/commits/main --jq .sha']);
    });

    it('deploys when its commit is still the tip of main', () => {
      // The flaky run of the newest commit, run again until it passed.
      const api = github(HEAD);

      const result = runStep(script, { ...ciRun({ RUN_ATTEMPT: '3' }), ...api.env });

      expect(result.status).toBe(0);
      expect(result.outputs).toMatchObject(PRODUCTION);
    });

    it('stops when the tip of main cannot be read', () => {
      const api = github(undefined);

      const result = runStep(script, { ...ciRun({ RUN_ATTEMPT: '2' }), ...api.env });

      expect(result.status).toBe(1);
      expect(result.outputs).toEqual({});
    });

    it('treats a run with no attempt number as one that was run again', () => {
      const api = github(OLDER);

      const result = runStep(script, { ...ciRun({ RUN_ATTEMPT: '' }), ...api.env });

      expect(result.status).toBe(0);
      expect(result.outputs).toMatchObject(NOTHING);
    });

    it('does not ask for the tip on a first attempt: main may have moved on', () => {
      // A newer push is in CI already; this run's commit passed and deploys.
      const api = github(OLDER);

      const result = runStep(script, { ...ciRun(), ...api.env });

      expect(result.status).toBe(0);
      expect(result.outputs).toMatchObject(PRODUCTION);
      expect(api.calls()).toEqual([]);
    });
  });

  it('builds and deploys staging on a push to the staging branch', () => {
    const { status, outputs } = runStep(script, {
      EVENT_NAME: 'push',
      REF_NAME: 'staging',
      COMMIT_SHA: HEAD,
    });

    expect(status).toBe(0);
    expect(outputs).toEqual({
      environment: 'staging',
      mode: 'deploy',
      sha: HEAD,
      app: 'true',
      build: 'true',
      demo: 'false',
      terraform: 'false',
    });
  });

  it('refuses a push to any other branch and any other event', () => {
    expect(runStep(script, { EVENT_NAME: 'push', REF_NAME: 'main', COMMIT_SHA: HEAD }).status).toBe(
      1,
    );
    expect(runStep(script, { EVENT_NAME: 'pull_request', REF_NAME: 'x' }).status).toBe(1);
  });

  it.each([
    ['staging', 'feature', { app: 'true', build: 'true', demo: 'false' }],
    ['production', 'main', { app: 'true', build: 'false', demo: 'false' }],
    ['demo', 'feature', { app: 'false', build: 'false', demo: 'true' }],
  ])('deploys %s by hand from %s', (environment, ref, expected) => {
    // One CI run of a push to main has passed for this commit.
    const api = github(undefined, '1');

    const { status, outputs } = runStep(script, {
      ...manual({ INPUT_ENVIRONMENT: environment }, ref),
      ...api.env,
    });

    expect(status).toBe(0);
    expect(outputs).toEqual({
      environment,
      mode: 'deploy',
      sha: HEAD,
      terraform: 'false',
      ...expected,
    });
    // Only production waits for CI: staging builds its own images after its
    // own merge gate, and the demo builds its own as well.
    expect(api.calls()).toHaveLength(environment === 'production' ? 1 : 0);
  });

  describe('a manual production deploy and the verdict of CI', () => {
    // The images of a commit exist as soon as the `images` job of its CI run
    // has pushed them, which needs only the two gates. Deployed by tag from
    // there, a commit whose scanners failed, or whose run is still going,
    // would reach production through the manual path.
    const production = manual({ INPUT_ENVIRONMENT: 'production' });

    it('lets the plan job read the runs of the CI workflow', () => {
      const job = withoutComments(jobOf(DEPLOY, 'plan'));

      expect(job).toMatch(/^ {4}permissions:\n {6}contents: read\n {6}actions: read$/mu);
      expect(stepOf(job, 'Decide')).toContain('REF: ${{ github.ref }}');
    });

    it('asks for a passed CI run that a push to main started for this very commit', () => {
      const api = github(undefined, '1');

      const result = runStep(script, { ...production, ...api.env });

      expect(result.status).toBe(0);
      const [call = '', ...others] = api.calls();
      expect(others).toEqual([]);
      const query = new URLSearchParams(call.split(' ')[1]?.split('?')[1] ?? '');
      expect(Object.fromEntries(query)).toMatchObject({
        head_sha: HEAD,
        event: 'push',
        branch: 'main',
        status: 'success',
      });
    });

    it('refuses when no CI run has passed for the commit', () => {
      const result = runStep(script, { ...production, ...github(undefined, '0').env });

      expect(result.status).toBe(1);
      expect(result.outputs).toEqual({});
      expect(result.log).toContain('CI');
      expect(result.log).toContain('rollback_sha');
    });

    it.each([
      ['cannot be asked', undefined],
      ['answers with something that is not a count', 'Not Found'],
    ])('refuses when GitHub %s', (_label, answer) => {
      const result = runStep(script, { ...production, ...github(undefined, answer).env });

      expect(result.status).toBe(1);
      expect(result.outputs).toEqual({});
    });

    it('refuses a tag that is named main', () => {
      const result = runStep(script, {
        ...production,
        REF: 'refs/tags/main',
        ...github(undefined, '1').env,
      });

      expect(result.status).toBe(1);
      expect(result.outputs).toEqual({});
    });

    it('keeps rollback_sha as the explicit way around it', () => {
      const api = github(undefined, '0');

      const result = runStep(script, {
        ...manual({ INPUT_ENVIRONMENT: 'production', INPUT_ROLLBACK_SHA: OLDER }, 'feature'),
        ...api.env,
      });

      expect(result.status).toBe(0);
      expect(result.outputs).toMatchObject({ mode: 'rollback', sha: OLDER, app: 'true' });
      expect(api.calls()).toEqual([]);
    });
  });

  it('refuses a manual production deploy from a branch CI built no images for', () => {
    const result = runStep(script, manual({ INPUT_ENVIRONMENT: 'production' }, 'feature'));

    expect(result.status).toBe(1);
    expect(result.log).toContain('rollback_sha');
  });

  it.each([
    ['staging', { app: 'true', demo: 'false' }],
    ['production', { app: 'true', demo: 'false' }],
    ['demo', { app: 'false', demo: 'true' }],
  ])('rolls %s back to a given commit without building anything', (environment, expected) => {
    const { status, outputs } = runStep(
      script,
      manual({ INPUT_ENVIRONMENT: environment, INPUT_ROLLBACK_SHA: OLDER }, 'feature'),
    );

    expect(status).toBe(0);
    expect(outputs).toEqual({
      environment,
      mode: 'rollback',
      sha: OLDER,
      build: 'false',
      terraform: 'false',
      ...expected,
    });
  });

  it.each([
    ['a short SHA', OLDER.slice(0, 7)],
    ['an upper-case SHA', OLDER.toUpperCase()],
    ['a branch name', 'main'],
    ['a tag', 'v1.2.3'],
    ['a SHA with something after it', `${OLDER} extra`],
    ['a SHA on a second line', `x\n${OLDER}`],
    ['shell syntax', '$(id)'],
  ])('refuses %s as the rollback target', (_label, value) => {
    const result = runStep(script, manual({ INPUT_ROLLBACK_SHA: value }));

    expect(result.status).toBe(1);
    expect(result.outputs).toEqual({});
  });

  it.each(['plan', 'apply'])('runs Terraform %s and nothing else', (action) => {
    const { status, outputs } = runStep(
      script,
      manual({ INPUT_ENVIRONMENT: 'production', INPUT_TERRAFORM: action }, 'feature'),
    );

    expect(status).toBe(0);
    expect(outputs).toEqual({
      environment: 'production',
      mode: 'terraform',
      sha: HEAD,
      app: 'false',
      build: 'false',
      demo: 'false',
      terraform: 'true',
    });
  });

  it('never runs Terraform on its own', () => {
    for (const env of [
      ciRun(),
      { EVENT_NAME: 'push', REF_NAME: 'staging', COMMIT_SHA: HEAD },
      manual({}),
      manual({ INPUT_ROLLBACK_SHA: OLDER }),
    ]) {
      expect(runStep(script, env).outputs['terraform']).toBe('false');
    }
  });

  it.each([
    ['together with a rollback', { INPUT_TERRAFORM: 'plan', INPUT_ROLLBACK_SHA: OLDER }],
    ['for the demo host', { INPUT_TERRAFORM: 'plan', INPUT_ENVIRONMENT: 'demo' }],
    ['with an unknown action', { INPUT_TERRAFORM: 'destroy' }],
  ])('refuses Terraform %s', (_label, inputs) => {
    expect(runStep(script, manual(inputs)).status).toBe(1);
  });

  it('refuses an unknown environment', () => {
    expect(runStep(script, manual({ INPUT_ENVIRONMENT: 'prod' })).status).toBe(1);
  });
});

describe('deploy.yml: the app job', () => {
  const job = jobOf(DEPLOY, 'app');

  describe('the target server', () => {
    const script = blockOf(stepOf(job, 'Resolve the target server'), 'run');
    const CONFIGURED = {
      DEPLOY_ENV: 'production',
      DEPLOY_HOST: '203.0.113.7',
      SSH_PRIVATE_KEY: 'k',
    };

    it('falls back to the server address when no domain is configured', () => {
      const { status, outputs } = runStep(script, { ...CONFIGURED, EVENT_NAME: 'workflow_run' });

      expect(status).toBe(0);
      expect(outputs).toEqual({ enabled: 'true', host: '203.0.113.7', domain: '203.0.113.7' });
    });

    it('uses the configured domain', () => {
      const { outputs } = runStep(script, {
        ...CONFIGURED,
        EVENT_NAME: 'workflow_run',
        DEPLOY_DOMAIN: 'app.example.test',
      });

      expect(outputs['domain']).toBe('app.example.test');
    });

    it.each([
      ['no host', { DEPLOY_HOST: '' }],
      ['no SSH key', { SSH_PRIVATE_KEY: '' }],
    ])('skips an automatic run with %s, with a warning', (_label, missing) => {
      const result = runStep(script, { ...CONFIGURED, ...missing, EVENT_NAME: 'workflow_run' });

      expect(result.status).toBe(0);
      expect(result.outputs).toEqual({ enabled: 'false' });
      expect(result.log).toContain('::warning::');
    });

    it('fails a manual run with no server configured', () => {
      const result = runStep(script, {
        ...CONFIGURED,
        DEPLOY_HOST: '',
        EVENT_NAME: 'workflow_dispatch',
      });

      expect(result.status).toBe(1);
      expect(result.log).toContain('::error::');
    });

    describe('the host key', () => {
      // The first thing sent over the connection is every production secret.
      // Without a pinned key, whoever answers at the address receives them.
      const FINGERPRINT = 'SHA256:fixtureHostKeyFingerprint0123456789abcdefgh';

      it('gives the SSH action the pinned fingerprint of the server', () => {
        const step = stepOf(job, 'Deploy on the server');

        expect(step).toContain('          fingerprint: ${{ secrets.SSH_HOST_FINGERPRINT }}');
        expect(stepOf(job, 'Resolve the target server')).toContain(
          'SSH_HOST_FINGERPRINT: ${{ secrets.SSH_HOST_FINGERPRINT }}',
        );
      });

      it('says so, on every run, while no fingerprint is configured', () => {
        const result = runStep(script, { ...CONFIGURED, EVENT_NAME: 'workflow_run' });

        expect(result.status).toBe(0);
        expect(result.outputs['enabled']).toBe('true');
        expect(result.log).toContain('::warning::');
        expect(result.log).toContain('SSH_HOST_FINGERPRINT');
      });

      it('is silent once the fingerprint is configured', () => {
        const result = runStep(script, {
          ...CONFIGURED,
          EVENT_NAME: 'workflow_run',
          SSH_HOST_FINGERPRINT: FINGERPRINT,
        });

        expect(result.status).toBe(0);
        expect(result.log).not.toContain('::warning::');
      });

      it('refuses a value that is not a SHA256 fingerprint', () => {
        // An MD5 fingerprint or a whole key line would never match: the deploy
        // would fail at the connection with a message about the server.
        const result = runStep(script, {
          ...CONFIGURED,
          EVENT_NAME: 'workflow_run',
          SSH_HOST_FINGERPRINT: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixture',
        });

        expect(result.status).toBe(1);
        expect(result.log).toContain('SHA256:');
      });
    });

    it('guards every later step with the result', () => {
      const steps = job.split(/\n(?= {6}- )/u).slice(1);
      const later = steps.filter((text) => !text.includes('id: target'));

      expect(later.length).toBeGreaterThan(3);
      for (const text of later) {
        expect(text, text.split('\n')[0]).toContain("steps.target.outputs.enabled == 'true'");
      }
    });
  });

  describe('the image references', () => {
    const script = blockOf(stepOf(job, 'Resolve the image references'), 'run');
    const SHA = '0123456789abcdef0123456789abcdef01234567';
    const BASE = {
      DEPLOY_SHA: SHA,
      INPUT_REGISTRY: 'ghcr.io',
      INPUT_IMAGE_NAME_RAW: 'App',
      INPUT_REPO_OWNER: 'Acme',
    };
    const scratch: string[] = [];

    afterEach(() => {
      for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    function workspace(artifact?: Readonly<Record<string, string>>): string {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bslt-deploy-images-'));
      scratch.push(dir);
      if (artifact !== undefined) {
        mkdirSync(path.join(dir, '.deploy-image'));
        writeFileSync(
          path.join(dir, '.deploy-image/deployment-images.json'),
          JSON.stringify(artifact),
        );
      }
      return dir;
    }

    it('takes the digests of the CI run that started the deploy', () => {
      const artifact = {
        api_image: 'ghcr.io/acme/app@sha256:aaaa',
        web_image: 'ghcr.io/acme/app@sha256:bbbb',
      };

      const { status, outputs } = runStep(
        script,
        { ...BASE, EVENT_NAME: 'workflow_run' },
        workspace(artifact),
      );

      expect(status).toBe(0);
      expect(outputs).toMatchObject({ ...artifact, source: 'ci-artifact' });
    });

    it('fails when the CI run left no image artifact', () => {
      expect(runStep(script, { ...BASE, EVENT_NAME: 'workflow_run' }, workspace()).status).toBe(1);
      expect(
        runStep(script, { ...BASE, EVENT_NAME: 'workflow_run' }, workspace({ api_image: 'x' }))
          .status,
      ).toBe(1);
    });

    it.each(['push', 'workflow_dispatch'])(
      'names the images by the commit tag on %s, in lower case',
      (event) => {
        const { status, outputs } = runStep(script, { ...BASE, EVENT_NAME: event }, workspace());

        expect(status).toBe(0);
        expect(outputs).toEqual({
          registry: 'ghcr.io',
          api_image: `ghcr.io/acme/app:${SHA}-api`,
          web_image: `ghcr.io/acme/app:${SHA}-web`,
          source: 'commit-tag',
        });
      },
    );

    it('names them as the jobs that push them do', () => {
      // ci.yml `images` and deploy.yml `staging-images` tag `<sha>-api` and
      // `<sha>-web` under the same lower-cased name.
      for (const [workflow, id, sha] of [
        [CI, 'images', 'GITHUB_SHA'],
        [DEPLOY, 'staging-images', 'DEPLOY_SHA'],
      ] as const) {
        const resolve = blockOf(stepOf(jobOf(workflow, id), 'Resolve image variables'), 'run');
        const { status, outputs } = runStep(resolve, { ...BASE, [sha]: SHA });

        expect(status).toBe(0);
        expect(outputs['api_tag']).toBe(`ghcr.io/acme/app:${SHA}-api`);
        expect(outputs['web_tag']).toBe(`ghcr.io/acme/app:${SHA}-web`);
      }
    });
  });

  it('checks the public health endpoint after the containers', () => {
    const script = blockOf(stepOf(job, 'Smoke test'), 'run');

    expect(job.indexOf('name: Smoke test')).toBeGreaterThan(
      job.indexOf('name: Deploy on the server'),
    );
    expect(script).toContain('https://${DEPLOY_DOMAIN}/api/health');
    expect(script).toContain('exit 1');
  });
});

describe('deploy.yml: staging-images', () => {
  /** The `with:` block of a step, without comment lines. */
  function inputsOf(step: string): string {
    const lines = step.split('\n');
    const start = lines.findIndex((line) => line === '        with:');
    return lines
      .slice(start)
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n')
      .trimEnd();
  }

  it.each(['Build and push the API image', 'Build and push the web image'])(
    '"%s" takes the inputs the CI image build takes',
    (name) => {
      // The vite-build-args gate audits the CI build only. Staging has to
      // build the same way, or it stops being a rehearsal of production.
      const ci = stepOf(jobOf(CI, 'images'), name);
      const staging = stepOf(jobOf(DEPLOY, 'staging-images'), name);

      expect(inputsOf(staging)).toBe(inputsOf(ci));
      expect(inputsOf(staging)).toContain('push: true');
    },
  );

  it('runs the merge gate before it builds, since no CI run precedes a staging push', () => {
    const job = jobOf(DEPLOY, 'staging-images');

    expect(job.indexOf('run: pnpm bslt gate merge')).toBeGreaterThan(-1);
    expect(job.indexOf('run: pnpm bslt gate merge')).toBeLessThan(
      job.indexOf('name: Build and push the API image'),
    );
  });
});

describe('deploy.yml: Cloudflare web job retirement (Phase 18, D7)', () => {
  it('retires the separate Cloudflare static web job in favor of the PROCESS_ROLE=web container', () => {
    expect([...jobsOf(DEPLOY).keys()]).not.toContain('web');
    expect(withoutComments(DEPLOY)).not.toContain('wrangler-action');
  });
});

describe('deploy.yml: Terraform', () => {
  const job = jobOf(DEPLOY, 'terraform');
  const script = blockOf(stepOf(job, 'Check the state backend'), 'run');
  const scratch: string[] = [];

  afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A checkout whose provider directory holds `main.tf` with the given text. */
  function checkout(mainTf: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bslt-terraform-'));
    scratch.push(dir);
    mkdirSync(path.join(dir, 'infra/cloud/digitalocean'), { recursive: true });
    writeFileSync(path.join(dir, 'infra/cloud/digitalocean/main.tf'), mainTf);
    return dir;
  }

  const LOCAL_STATE = 'terraform {\n  required_version = ">= 1.0"\n  # backend "s3" {\n  # }\n}\n';
  const REMOTE_STATE = 'terraform {\n  backend "s3" {\n    bucket = "state"\n  }\n}\n';

  it('refuses apply when no remote state backend is declared', () => {
    const result = runStep(
      script,
      { PROVIDER: 'digitalocean', TF_ACTION: 'apply' },
      checkout(LOCAL_STATE),
    );

    expect(result.status).toBe(1);
    expect(result.log).toContain('apply is refused');
  });

  it('lets a plan run without one, and says what it is worth', () => {
    const result = runStep(
      script,
      { PROVIDER: 'digitalocean', TF_ACTION: 'plan' },
      checkout(LOCAL_STATE),
    );

    expect(result.status).toBe(0);
    expect(result.outputs).toEqual({ remote: 'false' });
    expect(result.log).toContain('::warning::');
  });

  it.each(['plan', 'apply'])('lets %s run once a backend is declared', (action) => {
    const result = runStep(
      script,
      { PROVIDER: 'digitalocean', TF_ACTION: action },
      checkout(REMOTE_STATE),
    );

    expect(result.status).toBe(0);
    expect(result.outputs).toEqual({ remote: 'true' });
  });

  it.each(['digitalocean', 'gcp'])(
    'refuses apply for %s in this repository, which ships no backend',
    (provider) => {
      // The owner decision for the template: Terraform is reference code and
      // is not applied; the state backend is the fork's to add.
      const result = runStep(script, { PROVIDER: provider, TF_ACTION: 'apply' }, PATHS.root);

      expect(result.status).toBe(1);
    },
  );

  it('applies only the plan it showed, only when asked and only with remote state', () => {
    const apply = stepOf(job, 'Terraform apply');

    expect(apply).toContain(
      "if: inputs.terraform == 'apply' && steps.backend.outputs.remote == 'true'",
    );
    expect(apply).toContain('terraform apply -no-color -auto-approve tfplan');
    expect(job.indexOf('name: Check the state backend')).toBeLessThan(
      job.indexOf('name: Terraform init'),
    );
    expect(job.indexOf('name: Terraform plan')).toBeLessThan(job.indexOf('name: Terraform apply'));
  });

  it('offers no destroy and keeps no state on the runner or in an artifact', () => {
    expect(withoutComments(DEPLOY)).not.toMatch(/terraform destroy/u);
    expect(job).not.toContain('upload-artifact');
    expect(job).not.toContain('tfstate');
  });

  it('is the only job that touches Terraform', () => {
    for (const [id, text] of jobsOf(DEPLOY)) {
      if (id !== 'terraform' && id !== 'plan') {
        expect(withoutComments(text), id).not.toMatch(/terraform/iu);
      }
    }
  });
});
