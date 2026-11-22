// main/tools/scripts/dev/workflow-dump.ts
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Args {
  runId?: string;
  branch: string;
  outDir: string;
}

function runGh(args: string[], allowFailure = false): string {
  const result = spawnSync('gh', args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 32,
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0 && !allowFailure) {
    const stderr = (result.stderr ?? '').trim();
    throw new Error(stderr || `gh ${args.join(' ')} failed with status ${result.status}`);
  }

  return (result.stdout ?? '').trim();
}

function runGhToFile(args: string[], filePath: string, allowFailure = false): void {
  const output = runGh(args, allowFailure);
  writeFileSync(filePath, output, 'utf-8');
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    branch: 'main',
    outDir: '.tmp/workflow-dumps',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: pnpm bslt workflow-dump [--run-id <id>] [--branch <name>] [--out-dir <path>]',
          '',
          'Examples:',
          '  pnpm bslt workflow-dump --run-id 123456789',
          '  pnpm bslt workflow-dump --branch main',
          '',
          'Behavior:',
          '  - If --run-id is omitted, resolves latest failed run on branch (default: main).',
          '  - If no failed run exists, falls back to latest run on branch.',
        ].join('\n'),
      );
      process.exit(0);
    }

    const nextRunId = argv[i + 1];
    if (arg === '--run-id' && nextRunId != null) {
      args.runId = nextRunId;
      i += 1;
      continue;
    }
    const nextBranch = argv[i + 1];
    if (arg === '--branch' && nextBranch != null) {
      args.branch = nextBranch;
      i += 1;
      continue;
    }
    const nextOutDir = argv[i + 1];
    if (arg === '--out-dir' && nextOutDir != null) {
      args.outDir = nextOutDir;
      i += 1;
      continue;
    }
  }

  return args;
}

function resolveRunId(branch: string): string {
  const failedRaw = runGh(
    [
      'run',
      'list',
      '--branch',
      branch,
      '--status',
      'failure',
      '--limit',
      '1',
      '--json',
      'databaseId',
    ],
    true,
  );
  const failedRuns = JSON.parse(failedRaw || '[]') as Array<{
    databaseId?: number;
  }>;
  const failed = failedRuns[0]?.databaseId;
  if (failed != null) return String(failed);

  const latestRaw = runGh([
    'run',
    'list',
    '--branch',
    branch,
    '--limit',
    '1',
    '--json',
    'databaseId',
  ]);
  const latestRuns = JSON.parse(latestRaw || '[]') as Array<{
    databaseId?: number;
  }>;
  const latest = latestRuns[0]?.databaseId;
  if (!latest) {
    throw new Error(`No workflow runs found for branch "${branch}".`);
  }
  return String(latest);
}

export function main(argv: readonly string[] = []): void {
  const args = parseArgs(argv);

  try {
    runGh(['--version']);
  } catch {
    console.error('GitHub CLI (gh) is required. Install it and run `gh auth login`.');
    process.exit(1);
  }

  const runId = args.runId ?? resolveRunId(args.branch);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseDir = resolve(args.outDir, `${runId}-${timestamp}`);
  mkdirSync(baseDir, { recursive: true });

  const metaText = runGh(['run', 'view', runId]);
  writeFileSync(resolve(baseDir, 'run-meta.txt'), `${metaText}\n`, 'utf-8');

  const metaJson = runGh([
    'run',
    'view',
    runId,
    '--json',
    'databaseId,name,workflowName,headBranch,headSha,status,conclusion,url,event,createdAt,startedAt,updatedAt,jobs',
  ]);
  writeFileSync(resolve(baseDir, 'run-meta.json'), `${metaJson}\n`, 'utf-8');

  const failedLogPath = resolve(baseDir, 'run-failed.log');
  const fullLogPath = resolve(baseDir, 'run-full.log');
  runGhToFile(['run', 'view', runId, '--log-failed'], failedLogPath, true);
  runGhToFile(['run', 'view', runId, '--log'], fullLogPath);

  const failedLogs = readFileSync(failedLogPath, 'utf-8').trim();
  const fullLogs = readFileSync(fullLogPath, 'utf-8').trim();

  const reviewBundle = [
    '=== RUN META ===',
    metaText,
    '',
    '=== FAILED LOGS ===',
    failedLogs || '(no failed logs found)',
    '',
    '=== FULL LOGS ===',
    fullLogs,
  ].join('\n');
  const bundlePath = resolve(baseDir, 'workflow-review.txt');
  writeFileSync(bundlePath, `${reviewBundle}\n`, 'utf-8');

  console.log(`Saved workflow dump for run ${runId} in: ${baseDir}`);
  console.log(`Single-file review bundle: ${bundlePath}`);
}
