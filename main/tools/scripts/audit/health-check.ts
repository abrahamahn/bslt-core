// main/tools/scripts/audit/health-check.ts

import { spawn, spawnSync } from 'child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from '../../lib/paths';

/** Runs turbo lint, type-check and test and prints a per-package problem report. */
export function run(): Promise<number> {
  console.log('🔍 Starting Monorepo Health Audit...');
  const preflightCommands: string[] = [];
  for (const command of preflightCommands) {
    console.log(`   Running preflight: pnpm -w run ${command}\n`);
    const preflight = spawnSync('pnpm', ['-w', 'run', command], {
      stdio: 'inherit',
    });

    if ((preflight.status ?? 1) !== 0) {
      console.error(`\n❌ Preflight failed: ${command}`);
      return Promise.resolve(preflight.status ?? 1);
    }
  }

  console.log('\n   Running: turbo run lint type-check --continue\n');

  const start = Date.now();

  // We explicitly bake in --continue here regardless of package.json to be safe,
  // but since we updated package.json it's redundant but harmless.
  const child = spawn('turbo', ['run', 'lint', 'type-check', 'test', '--continue'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  let output = '';

  child.stdout?.on('data', (data) => {
    const str = data.toString();
    output += str;
    process.stdout.write(str); // Stream to user
  });

  child.stderr?.on('data', (data) => {
    const str = data.toString();
    output += str; // Capture all for parsing
    process.stderr.write(str);
  });

  return new Promise((resolveExit) => {
    child.on('close', (code) => {
      const duration = ((Date.now() - start) / 1000).toFixed(2);
      console.log(`\n\n🏁 Audit completed in ${duration}s (Exit Code: ${code})`);

      parseOutput(output);

      // Exit with the original code
      resolveExit(code ?? 1);
    });
  });
}

export function parseOutput(fullLog: string) {
  console.log('\n──────────────────────────────────────────────────────────────────────────────');
  console.log('📊 MONOREPO HEALTH REPORT');
  console.log('──────────────────────────────────────────────────────────────────────────────');

  type TaskName = 'lint' | 'type-check' | 'test' | 'other';

  const ESLINT_REGEX = /✖\s+(\d+)\s+problems?\s+\((\d+)\s+errors?,\s+(\d+)\s+warnings?\)/;
  const TSC_SUMMARY_REGEX = /Found\s+(\d+)\s+errors?/i;
  const TSC_LINE_REGEX = /(^|:)\s*error\s+TS\d+:/i;
  const VITEST_FAILED_TESTS_REGEX = /(?:^|\s)(?:Tests?|Test)\s*:?\s*(\d+)\s+failed(?:\b|\s*[|,])/i;
  const VITEST_RUNNER_ERRORS_REGEX = /(?:^|\s)Errors?\s+(\d+)\s+errors?\b/i;

  interface PackageStats {
    lint: number;
    type: number;
    test: number;
    warnings: number;
  }

  const packageStats: Record<string, PackageStats> = {};

  /** A group that matched is always present; the guard keeps a shape change from yielding NaN. */
  function toCount(value: string | undefined): number {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  // Pre-populate package list to ensure we show all packages, even those with 0 output
  interface PnpmPackageInfo {
    name?: string;
  }

  try {
    const listProc = spawnSync('pnpm', ['m', 'ls', '--json', '--depth=-1'], {
      encoding: 'utf-8',
    });
    if (listProc.error) throw listProc.error;
    if (listProc.stderr && listProc.stderr.length > 0) process.stderr.write(listProc.stderr);

    const packages = JSON.parse(listProc.stdout) as PnpmPackageInfo[];
    for (const pkg of packages) {
      if (pkg.name && pkg.name !== '@bslt/root') {
        packageStats[pkg.name] = { lint: 0, type: 0, test: 0, warnings: 0 };
      }
    }
  } catch {
    console.warn('⚠️ Could not auto-detect package list via pnpm, trying fallback...');
    // Fallback: use find to locate package.json files
    try {
      const findProc = spawnSync(
        'find',
        ['.', '-name', 'package.json', '-not', '-path', '*/node_modules/*'],
        { encoding: 'utf-8' },
      );
      const files = findProc.stdout.split('\n').filter(Boolean);
      for (const f of files) {
        try {
          const pkgContent = readFileSync(resolve(REPO_ROOT, f), 'utf-8');
          const pkg = JSON.parse(pkgContent) as PnpmPackageInfo;
          if (pkg.name && pkg.name !== '@bslt/root') {
            packageStats[pkg.name] = { lint: 0, type: 0, test: 0, warnings: 0 };
          }
        } catch {
          /* ignore invalid json */
        }
      }
    } catch {
      console.warn('⚠️ Could not auto-detect package list via fallback either.');
    }
  }

  const lines = fullLog.split('\n');
  let currentPackage = 'unknown';
  let currentTask: TaskName = 'other';

  interface TypeTracking {
    summaryCount: number;
    tsLineSignatures: Set<string>;
  }
  interface TestTracking {
    failedTests: number;
    runnerErrors: number;
    seen: Set<string>;
  }

  const typeTracking: Record<string, TypeTracking> = {};
  const testTracking: Record<string, TestTracking> = {};

  // The `ensure*` helpers return the record they guaranteed, so callers hold a
  // definite reference instead of re-indexing a `Record` the compiler must widen.
  function ensurePackage(pkg: string): PackageStats {
    const existing = packageStats[pkg];
    if (existing) return existing;
    const created: PackageStats = { lint: 0, type: 0, test: 0, warnings: 0 };
    packageStats[pkg] = created;
    return created;
  }

  function normalizeTask(task: string): TaskName {
    if (task === 'lint') return 'lint';
    if (task === 'type-check') return 'type-check';
    if (task === 'test') return 'test';
    return 'other';
  }

  function ensureTypeTracking(pkg: string): TypeTracking {
    const existing = typeTracking[pkg];
    if (existing) return existing;
    const created: TypeTracking = { summaryCount: 0, tsLineSignatures: new Set<string>() };
    typeTracking[pkg] = created;
    return created;
  }

  function ensureTestTracking(pkg: string): TestTracking {
    const existing = testTracking[pkg];
    if (existing) return existing;
    const created: TestTracking = { failedTests: 0, runnerErrors: 0, seen: new Set<string>() };
    testTracking[pkg] = created;
    return created;
  }

  // Built dynamically because eslint's no-control-regex forbids the literal ESC byte.
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
  for (const rawLine of lines) {
    const line = rawLine.replace(ansiPattern, '');
    const prefixMatch = line.match(/^(@?[a-zA-Z0-9/-]+):([a-z-]+):\s?(.*)$/);
    const [, matchedPackage, matchedTask, matchedContent] = prefixMatch ?? [];
    const content = matchedContent ?? line;

    if (matchedPackage !== undefined && matchedTask !== undefined) {
      currentPackage = matchedPackage;
      currentTask = normalizeTask(matchedTask);
    }

    const stats = ensurePackage(currentPackage);

    const eslintMatch = ESLINT_REGEX.exec(content);
    if (eslintMatch && currentTask === 'lint') {
      stats.lint += toCount(eslintMatch[2]);
      stats.warnings += toCount(eslintMatch[3]);
    }

    if (currentTask === 'type-check') {
      const tscSummaryMatch = TSC_SUMMARY_REGEX.exec(content);
      if (tscSummaryMatch) {
        ensureTypeTracking(currentPackage).summaryCount += toCount(tscSummaryMatch[1]);
      } else if (TSC_LINE_REGEX.test(content)) {
        // Deduplicate repeats of the same TS diagnostic text within package output.
        ensureTypeTracking(currentPackage).tsLineSignatures.add(content.trim());
      }
    }

    if (currentTask === 'test') {
      const tracking = ensureTestTracking(currentPackage);

      const failedTestsMatch = VITEST_FAILED_TESTS_REGEX.exec(content);
      if (failedTestsMatch) {
        const key = `failed:${content.trim()}`;
        if (!tracking.seen.has(key)) {
          tracking.seen.add(key);
          tracking.failedTests += toCount(failedTestsMatch[1]);
        }
      }

      const runnerErrorsMatch = VITEST_RUNNER_ERRORS_REGEX.exec(content);
      if (runnerErrorsMatch) {
        const key = `errors:${content.trim()}`;
        if (!tracking.seen.has(key)) {
          tracking.seen.add(key);
          tracking.runnerErrors += toCount(runnerErrorsMatch[1]);
        }
      }
    }
  }

  for (const [pkg, track] of Object.entries(typeTracking)) {
    ensurePackage(pkg).type +=
      track.summaryCount > 0 ? track.summaryCount : track.tsLineSignatures.size;
  }

  for (const [pkg, track] of Object.entries(testTracking)) {
    ensurePackage(pkg).test += track.failedTests + track.runnerErrors;
  }

  const totalLintErrors = Object.values(packageStats).reduce((acc, stats) => acc + stats.lint, 0);
  const totalLintWarnings = Object.values(packageStats).reduce(
    (acc, stats) => acc + stats.warnings,
    0,
  );
  const totalTypeErrors = Object.values(packageStats).reduce((acc, stats) => acc + stats.type, 0);
  const totalTestErrors = Object.values(packageStats).reduce((acc, stats) => acc + stats.test, 0);

  console.log(`\n🔴 Total Lint Errors:   ${totalLintErrors}`);
  console.log(`🟡 Total Lint Warnings: ${totalLintWarnings}`);
  console.log(`🔵 Total Type Errors:   ${totalTypeErrors}`);
  console.log(`🟣 Total Test Errors:   ${totalTestErrors}`);
  console.log(`💥 GRAND TOTAL ISSUES:  ${totalLintErrors + totalTypeErrors + totalTestErrors}`);

  // If exit code was failure but we found 0 errors, likely a crash or config error
  if (totalLintErrors + totalTypeErrors === 0 && fullLog.includes('Exit code:')) {
    console.log('\n⚠️  WARNING: Command failed but zero standard errors were parsed.');
    console.log('   This usually indicates a configuration error, crash, or non-standard output.');
    console.log('   Check the raw output above for details.');
  }

  console.log('\n📋 Package Status:');

  const sortedStats = Object.entries(packageStats).sort(([, a], [, b]) => {
    const totalA = a.lint + a.type + a.test;
    const totalB = b.lint + b.type + b.test;
    return totalB - totalA;
  });

  if (sortedStats.length === 0) {
    console.log('   (No explicit summary lines found - check output details above)');
  } else {
    sortedStats.forEach(([pkg, stats]) => {
      const total = stats.lint + stats.type + stats.test;
      const statusIcon = total === 0 ? '✅' : '❌';
      console.log(
        `   ${statusIcon} ${pkg.padEnd(30)}: ${total.toString().padEnd(5)} (Lint: ${stats.lint}, Type: ${stats.type}, Test: ${stats.test}, Warn: ${stats.warnings})`,
      );
    });
  }
  console.log('──────────────────────────────────────────────────────────────────────────────\n');
}
