// main/tools/scripts/dev/migration-failure.ts
/**
 * What `pnpm db:migrate` said when it failed under `pnpm dev`.
 *
 * `pnpm dev` migrates before it starts the servers and carries on when that
 * fails, with the command's output piped away. The one failure a developer has
 * to act on is an edited baseline, and the runner says how
 * (`run: pnpm bslt db reset`), so those lines are shown.
 */

const FAILURE_LINE = /Migration failed:/u;

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return '';
}

/**
 * The lines to show for a failed `execSync('pnpm db:migrate')`: from the
 * runner's failure line to the end, else the last `tail` lines of the output,
 * else the error's message.
 */
export function migrationFailureLines(error: unknown, tail = 8): string[] {
  const output = error as { stdout?: unknown; stderr?: unknown } | null;
  const lines = `${textOf(output?.stdout)}\n${textOf(output?.stderr)}`
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    return [error instanceof Error ? error.message : String(error)];
  }
  const start = lines.findIndex((line) => FAILURE_LINE.test(line));
  return start === -1 ? lines.slice(-tail) : lines.slice(start);
}
