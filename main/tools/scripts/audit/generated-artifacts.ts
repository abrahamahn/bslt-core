// main/tools/scripts/audit/generated-artifacts.ts
/**
 * Prevents generated build artifacts from being committed.
 *
 * Source-level generated files are allowed when they are part of the template
 * contract, but build outputs, source maps, tsbuildinfo files, and accidental
 * TypeScript emits must stay ignored or local-only.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { fail, pass, type CheckResult } from '../../gates/types';
import { REPO_ROOT } from '../../lib/paths';

interface ArtifactRule {
  readonly description: string;
  readonly test: (filePath: string) => boolean;
}

const GENERATED_ARTIFACT_RULES: readonly ArtifactRule[] = [
  {
    description: 'compiled dist output',
    test: (filePath) => filePath.split('/').includes('dist'),
  },
  {
    description: 'local cache output',
    test: (filePath) => filePath.split('/').includes('.cache'),
  },
  {
    description: 'TypeScript incremental build info',
    test: (filePath) => filePath.endsWith('.tsbuildinfo'),
  },
  {
    description: 'JavaScript source map',
    test: (filePath) => filePath.endsWith('.js.map'),
  },
  {
    description: 'declaration source map',
    test: (filePath) => filePath.endsWith('.d.ts.map'),
  },
  {
    description: 'accidental emitted package config',
    test: (filePath) => /(^|\/)(eslint|vite|vitest)\.config\.(js|d\.ts)$/u.test(filePath),
  },
  {
    description: 'accidental main/tools TypeScript emit',
    test: (filePath) =>
      filePath.startsWith('main/tools/') &&
      (filePath.endsWith('.js') || filePath.endsWith('.d.ts')),
  },
];

const LOCAL_SCAN_SKIP_DIRS = new Set([
  '.cache',
  '.agents',
  '.antigravity',
  '.claude',
  '.codex',
  '.cursor',
  '.gemini',
  '.git',
  '.idea',
  '.playwright-mcp',
  '.turbo',
  '.vitest',
  '.vscode',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'playwright-report',
  'test-results',
]);

const SOURCE_DECLARATION_ALLOWLIST = new Set([
  'main/apps/server/src/types/fastify.d.ts',
  'main/apps/web/src/vite-env.d.ts',
  'main/kernel/client/src/types/react-shim.d.ts',
  'main/modules/compliance/web/assets.d.ts',
]);

function isSourceAdjacentArtifact(filePath: string): boolean {
  if (SOURCE_DECLARATION_ALLOWLIST.has(filePath)) return false;
  if (filePath.endsWith('.js.map') || filePath.endsWith('.d.ts.map')) return true;
  if (filePath.endsWith('.tsbuildinfo')) return true;
  if (/(^|\/)(eslint|vite|vitest)\.config\.(js|d\.ts)$/u.test(filePath)) return true;
  if (/^main\/profiles\/[^/]+\.(js|d\.ts)$/u.test(filePath)) return true;
  if (
    filePath.startsWith('main/tools/') &&
    (filePath.endsWith('.js') || filePath.endsWith('.d.ts'))
  ) {
    return true;
  }
  if (/^main\/(apps|client|kernel|server|shared)\/[^/]+\/src\/.*\.(js|d\.ts)$/u.test(filePath)) {
    return true;
  }
  if (
    /^main\/modules\/[^/]+\/(?:module\.(js|d\.ts)|(?:contract|server|web)\/.*\.(js|d\.ts))$/u.test(
      filePath,
    )
  ) {
    return true;
  }
  return false;
}

function localSourceAdjacentArtifacts(directory = '.'): string[] {
  const artifacts: string[] = [];
  const entries = readdirSync(path.join(REPO_ROOT, directory), { withFileTypes: true });

  for (const entry of entries) {
    if (directory === '.' && entry.name === 'AGENTS.md') continue;
    if (entry.isDirectory() && LOCAL_SCAN_SKIP_DIRS.has(entry.name)) continue;

    const filePath = directory === '.' ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      artifacts.push(...localSourceAdjacentArtifacts(filePath));
      continue;
    }
    if (entry.isFile() && isSourceAdjacentArtifact(filePath)) {
      artifacts.push(filePath);
    }
  }

  return artifacts;
}

function trackedFiles(): string[] | string {
  const result = spawnSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status !== 0 || result.stdout.trim() === '') {
    const details =
      result.stderr.trim() || result.error?.message || 'git ls-files produced no output';
    return `cannot list git files: ${details}`;
  }

  return result.stdout.split(/\r?\n/u).filter(Boolean);
}

export function run(): CheckResult {
  const tracked = trackedFiles();
  if (typeof tracked === 'string') return fail(tracked);
  const trackedViolations = tracked.flatMap((filePath) => {
    if (!existsSync(path.join(REPO_ROOT, filePath))) return [];
    const rule = GENERATED_ARTIFACT_RULES.find((candidate) => candidate.test(filePath));
    if (rule === undefined) return [];
    return [{ filePath, description: rule.description }];
  });
  const localViolations = localSourceAdjacentArtifacts().flatMap((filePath) => {
    if (trackedViolations.some((violation) => violation.filePath === filePath)) return [];
    return [{ filePath, description: 'source-adjacent generated output' }];
  });
  const violations = [...trackedViolations, ...localViolations];

  if (violations.length === 0) {
    console.log('Generated artifact audit passed.');
    return pass('no generated output is tracked or left beside sources');
  }

  console.error('Generated artifact audit failed:');
  for (const violation of violations) {
    console.error(`- ${violation.filePath}: ${violation.description}`);
  }
  console.error(
    'Remove these files from git and keep generated output in ignored local directories.',
  );
  return fail(`${String(violations.length)} generated artifact(s) tracked or beside sources`);
}
